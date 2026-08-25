/**
 * Gmail thread search and full-mailbox sweeping.
 *
 * Replaces graph-search.ts (removed 2026-08-23). Owns search + thread assembly
 * only; auth, MIME parsing, and the raw API surface live in google-workspace.ts.
 *
 * Two consumers:
 * - Email Research (`/api/email-research/run`) — a term, a few threads, now.
 * - The mailbox sweep (`/api/email-sweep/*`) — every thread, incrementally,
 *   over hours or days.
 *
 * Gmail vs Graph, the differences that mattered:
 * - `q` filters server-side, including dates (`after:2025/01/01`), so the
 *   client-side date pass Graph forced on us is gone.
 * - A thread comes back whole in ONE call, already grouped. No conversationId
 *   filter, no rejected $orderby.
 * - `threadId` is per-mailbox: the same conversation in moose@ and tuaone@ has
 *   two different ids. RFC 2822 Message-ID is the only stable cross-mailbox
 *   key, so all dedupe here goes through {@link threadFingerprint}.
 */

import {
  MAILBOXES,
  fetchThread,
  listThreads,
  type MailMessage,
} from './google-workspace'

/** One thread, resolved to its messages, tagged with where it was found. */
export interface ResolvedThread {
  /** Stable across mailboxes — the earliest RFC Message-ID in the thread. */
  fingerprint: string
  mailbox: string
  threadId: string
  subject: string
  messages: MailMessage[]
  firstAt: string
  lastAt: string
  participants: string[]
  attachmentCount: number
}

/**
 * A thread's cross-mailbox identity: the Message-ID of its earliest message.
 * Two mailboxes holding the same conversation agree on this even though their
 * Gmail thread ids differ.
 */
export function threadFingerprint(messages: MailMessage[]): string {
  if (messages.length === 0) return ''
  // messages arrive oldest-first from fetchThread, but don't rely on it
  const earliest = messages.reduce((a, b) => (a.receivedAt <= b.receivedAt ? a : b))
  return earliest.messageId
}

/** Every distinct address that appears on a thread, lowercased. */
function participantsOf(messages: MailMessage[]): string[] {
  const seen = new Set<string>()
  for (const m of messages) {
    if (m.from?.address) seen.add(m.from.address)
    for (const t of m.to) seen.add(t.address)
    for (const c of m.cc) seen.add(c.address)
  }
  return [...seen]
}

function resolve(mailbox: string, threadId: string, messages: MailMessage[]): ResolvedThread | null {
  if (messages.length === 0) return null
  return {
    fingerprint: threadFingerprint(messages),
    mailbox,
    threadId,
    subject: messages[0].subject,
    messages,
    firstAt: messages[0].receivedAt,
    lastAt: messages[messages.length - 1].receivedAt,
    participants: participantsOf(messages),
    attachmentCount: messages.reduce(
      (n, m) => n + m.attachments.filter((a) => !a.isInline).length,
      0
    ),
  }
}

// ---------------------------------------------------------------------------
// Targeted search (Email Research)
// ---------------------------------------------------------------------------

/** Format a Date as Gmail's query date literal (YYYY/MM/DD). */
function gmailDate(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(
    d.getDate()
  ).padStart(2, '0')}`
}

/**
 * Gmail-side exclusions applied to the LEAD sweep.
 *
 * This is the cheapest filter in the whole pipeline and the only one that costs
 * nothing: a thread excluded here is never fetched, never stored, and never
 * scored. Gmail's own `category:promotions` / `category:social` classifiers do
 * most of the work for free, and `-label:bw-filtered` lets a human retire a
 * repeat marketing sender by writing one Gmail filter instead of shipping code.
 *
 * Override wholesale with GMAIL_LEAD_EXCLUSIONS (space separated).
 */
export const DEFAULT_LEAD_EXCLUSIONS =
  '-category:promotions -category:social -label:bw-filtered'

export function leadExclusions(): string[] {
  return (process.env.GMAIL_LEAD_EXCLUSIONS ?? DEFAULT_LEAD_EXCLUSIONS)
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Build a Gmail `q`. Quotes the term so multi-word searches stay phrases, and
 * pushes the date bound server-side.
 */
export function buildQuery(
  term: string,
  opts: { sinceDays?: number; includeSpamTrash?: boolean; exclusions?: string[] } = {}
): string {
  const parts: string[] = []
  if (term.trim()) {
    // Gmail treats " as a phrase delimiter; strip embedded ones rather than
    // escaping (it has no escape syntax) so the query can't be broken open.
    parts.push(`"${term.replace(/"/g, ' ').trim()}"`)
  }
  if (opts.sinceDays && opts.sinceDays > 0) {
    parts.push(`after:${gmailDate(new Date(Date.now() - opts.sinceDays * 86_400_000))}`)
  }
  if (!opts.includeSpamTrash) {
    parts.push('-in:spam', '-in:trash')
  }
  if (opts.exclusions?.length) parts.push(...opts.exclusions)
  return parts.join(' ')
}

export interface SearchResult {
  threads: ResolvedThread[]
  totalFound: number
  truncated: boolean
  /** Per-mailbox failures, already phrased for the user. */
  notes: string[]
}

/**
 * Search every configured mailbox for a term and return resolved threads,
 * newest first, deduped across mailboxes.
 */
export async function searchThreads(
  term: string,
  opts: { sinceDays?: number; maxThreads?: number; mailboxes?: readonly string[] } = {}
): Promise<SearchResult> {
  const mailboxes = opts.mailboxes ?? MAILBOXES
  const maxThreads = Math.min(opts.maxThreads ?? 15, 40)
  const q = buildQuery(term, { sinceDays: opts.sinceDays })
  const notes: string[] = []

  const perMailbox = await Promise.all(
    mailboxes.map(async (mailbox) => {
      try {
        // One page is plenty for a targeted search — Gmail returns newest first.
        const { threads, estimatedTotal } = await listThreads(mailbox, { q, maxResults: 100 })
        return { mailbox, stubs: threads, estimatedTotal: estimatedTotal ?? threads.length }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'search failed'
        notes.push(`Mailbox ${mailbox} could not be searched (${message.slice(0, 200)}).`)
        return null
      }
    })
  )

  const ok = perMailbox.filter((r): r is NonNullable<typeof r> => r !== null)
  if (ok.length === 0) {
    return { threads: [], totalFound: 0, truncated: false, notes }
  }

  // Resolve more than we need (dedupe collapses cross-mailbox copies), then trim.
  const budget = maxThreads * 2
  const resolved: ResolvedThread[] = []
  const seen = new Set<string>()

  for (const { mailbox, stubs } of ok) {
    for (const stub of stubs.slice(0, budget)) {
      if (resolved.length >= budget) break
      try {
        const messages = await fetchThread(mailbox, stub.threadId)
        const thread = resolve(mailbox, stub.threadId, messages)
        if (!thread || seen.has(thread.fingerprint)) continue
        seen.add(thread.fingerprint)
        resolved.push(thread)
      } catch (err) {
        notes.push(
          `A thread in ${mailbox} could not be read (${
            err instanceof Error ? err.message.slice(0, 120) : 'error'
          }).`
        )
      }
    }
  }

  resolved.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
  const totalFound = ok.reduce((sum, r) => sum + r.estimatedTotal, 0)

  return {
    threads: resolved.slice(0, maxThreads),
    totalFound,
    truncated: resolved.length > maxThreads,
    notes,
  }
}

// ---------------------------------------------------------------------------
// Full sweep (backfill)
// ---------------------------------------------------------------------------

export interface SweepPage {
  threads: ResolvedThread[]
  nextPageToken: string | null
  estimatedTotal: number | null
  /** Threads on this page skipped because another mailbox already yielded them. */
  duplicatesSkipped: number
  notes: string[]
}

/**
 * Read ONE page of a mailbox's history, resolving each thread to its messages.
 *
 * Deliberately page-at-a-time: a full backfill runs for hours, so the caller
 * checkpoints `nextPageToken` after every page and can resume from a crash,
 * a reboot, or a deploy without re-reading what it already has.
 *
 * `knownFingerprints` lets the caller skip threads already ingested from
 * another mailbox (or a previous run) before paying to fetch them — the stub
 * doesn't carry a fingerprint, so the saving is on the AI pass, not the fetch.
 */
export async function sweepPage(
  mailbox: string,
  opts: {
    pageToken?: string | null
    sinceDays?: number
    pageSize?: number
    knownFingerprints?: Set<string>
    /** Extra Gmail `q` terms — the lead sweep passes {@link leadExclusions}. */
    exclusions?: string[]
  } = {}
): Promise<SweepPage> {
  const q = buildQuery('', { sinceDays: opts.sinceDays, exclusions: opts.exclusions })
  const notes: string[] = []

  const { threads: stubs, nextPageToken, estimatedTotal } = await listThreads(mailbox, {
    q,
    pageToken: opts.pageToken,
    maxResults: opts.pageSize ?? 100,
  })

  const resolved: ResolvedThread[] = []
  let duplicatesSkipped = 0

  for (const stub of stubs) {
    try {
      const messages = await fetchThread(mailbox, stub.threadId)
      const thread = resolve(mailbox, stub.threadId, messages)
      if (!thread) continue
      if (opts.knownFingerprints?.has(thread.fingerprint)) {
        duplicatesSkipped++
        continue
      }
      opts.knownFingerprints?.add(thread.fingerprint)
      resolved.push(thread)
    } catch (err) {
      notes.push(
        `Thread ${stub.threadId} in ${mailbox} could not be read (${
          err instanceof Error ? err.message.slice(0, 120) : 'error'
        }).`
      )
    }
  }

  return { threads: resolved, nextPageToken, estimatedTotal, duplicatesSkipped, notes }
}

// ---------------------------------------------------------------------------
// Rendering — threads to the markdown the analyzer reads
// ---------------------------------------------------------------------------

function fmtAddress(a: { name: string; address: string } | null): string {
  if (!a) return 'Unknown'
  return a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address
}

/**
 * Render one thread as markdown for an AI pass.
 * `maxCharsPerMessage` guards against the one 90-page forwarded chain that
 * would otherwise blow the local model's context on its own.
 */
export function renderThread(
  thread: ResolvedThread,
  opts: { maxCharsPerMessage?: number; heading?: string } = {}
): string {
  const cap = opts.maxCharsPerMessage ?? 6_000
  const lines: string[] = [
    opts.heading ?? `## ${thread.subject}`,
    `Mailbox: ${thread.mailbox} · ${thread.messages.length} message(s), ${thread.firstAt.slice(
      0,
      10
    )} to ${thread.lastAt.slice(0, 10)}`,
    '',
  ]

  for (const m of thread.messages) {
    const to = m.to.map(fmtAddress).join(', ')
    lines.push(`### ${m.receivedAt.slice(0, 16).replace('T', ' ')} — ${fmtAddress(m.from)}`)
    if (to) lines.push(`To: ${to}`)
    lines.push('')
    const text = m.bodyText || m.snippet
    lines.push(text.slice(0, cap) + (text.length > cap ? '\n[… message truncated]' : ''))
    lines.push('')
  }

  return lines.join('\n')
}
