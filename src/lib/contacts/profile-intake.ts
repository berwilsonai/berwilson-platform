/**
 * People Intake — profile a person, or a whole cast, from the mail the platform
 * has already read.
 *
 * The problem this removes: typing a counterparty's title, employer and phone
 * into the directory by hand when every one of those facts is already sitting
 * in a signature block in moose@. The mailbox sweep stores each thread's
 * rendered markdown and its participant list (GIN-indexed), so the evidence is
 * a local query away — no Gmail call, no model call, no cost.
 *
 * Five stages, in order, each degrading rather than failing:
 *   1. Parse   — seeds out of whatever was pasted: "Name <email>", a bare
 *                address, a bare name, optionally with a "(role hint)".
 *   2. Resolve — stored threads for each seed. A name-only seed is resolved to
 *                an address by the display names in the mail, and REFUSES on a
 *                tie (§12: ambiguity must mean NO match).
 *   3. Top up  — a targeted Gmail search for anyone the sweep has not reached
 *                yet, stored through the sweep's own persist pass.
 *   4. Extract — one local-model call per person over their own threads:
 *                title, employer, direct phone, their role in the deal, what
 *                they have committed to. Signature blocks are where title and
 *                phone actually live.
 *   5. Web     — the existing Enrich Profile pass, reused unchanged. Mail wins
 *                every conflict: a signature is the person stating their own
 *                title; the web is a guess about it.
 *
 * Plus the fan-out: every address appearing in those threads that is NOT yet a
 * contact comes back as a cast candidate, ranked by how often it appears. That
 * is the stage that answers "and whoever the other firm's reps turn out to be"
 * without anyone having to ask.
 *
 * NOTHING here writes a party, an entity or a player link. It stages a draft;
 * the human confirms it. That invariant is the whole reason the mail side of
 * this platform is trusted.
 */

import { callGemini } from '@/lib/ai/gemini'
import { maxInputChars } from '@/lib/email-ingestion/analyze'
import { createAdminClient } from '@/lib/supabase/admin'
import { sweepDb } from '@/lib/email-sweep/db'
import { storeFetchedThreads } from '@/lib/email-sweep/fetch-phase'
import { searchThreads, renderThread } from '@/lib/integrations/gmail-search'
import { isGoogleConfigured, MAILBOXES } from '@/lib/integrations/google-workspace'
import { researchPersonWeb, lookupDirectoryContact, directoryPhone } from '@/lib/contacts/web-enrichment'
import type { ResearchSource } from '@/lib/ai/research'

// ── Types ────────────────────────────────────────────────────────────────────

export interface PersonSeed {
  /** Lowercased, or null when only a name was given. */
  email: string | null
  name: string | null
  /** Whatever was in parentheses — "land owner", "Avant executive". */
  hint: string | null
  /** Exactly as typed, so the reviewer can see what produced a row. */
  raw: string
}

export interface ThreadRef {
  id: string
  subject: string | null
  last_at: string | null
  mailbox: string
  message_count: number
}

/** Who a person appears alongside, straight out of the mail. */
export interface PartyCandidate {
  id: string
  full_name: string
  company: string | null
  email: string | null
}

export interface PersonProfileDraft {
  /** Stable key for the review UI; not a database id. */
  ref: string
  seed: PersonSeed

  // ── identity ──
  email: string | null
  /** As the mail headers write it — the most reliable name available. */
  display_name: string | null
  full_name: string | null
  title: string | null
  company: string | null
  phone: string | null
  linkedin_url: string | null

  // ── this deal ──
  /** What they are DOING here: "land owner", "introducing broker". */
  role: string | null
  /** Two or three sentences: who they are and what they have done in this mail. */
  summary: string | null
  /** Outstanding obligations spotted in their own words. */
  commitments: string[]
  /** Other people they appear with, by name. */
  works_with: string[]
  /** Other spellings of their name seen in the mail. */
  aliases: string[]

  // ── evidence ──
  thread_count: number
  first_seen: string | null
  last_seen: string | null
  threads: ThreadRef[]
  /** Where the facts above came from, so the reviewer can weigh them. */
  evidence: 'mail' | 'directory' | 'web' | 'none'
  sources: ResearchSource[]
  researched: boolean
  research_error: string | null

  // ── directory matching ──
  existing_party_id: string | null
  existing_party_name: string | null
  match_type: 'exact_email' | 'exact_name' | 'fuzzy_name' | 'none'
  /** Several records fit equally well — the draft refuses to choose. */
  ambiguous: boolean
  candidates: PartyCandidate[]

  /** Why this row found nothing, phrased for the reviewer. */
  note: string | null
}

export interface CastCandidate {
  email: string
  display_name: string | null
  /** Bare domain — the fastest read on which firm someone belongs to. */
  domain: string
  thread_count: number
  /** Subjects they appear in, newest first, capped. */
  subjects: string[]
  existing_party_id: string | null
  existing_party_name: string | null
}

export interface ProfileIntakeDraft {
  people: PersonProfileDraft[]
  cast: CastCandidate[]
  /** Per-stage degradations, already phrased for the reviewer. */
  notes: string[]
  stats: {
    threads_read: number
    threads_fetched_live: number
    mailboxes: string[]
  }
}

// ── 1. Seed parsing ──────────────────────────────────────────────────────────

const EMAIL_RE = /[\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/

/**
 * Split on commas, semicolons and newlines — but never inside `<…>` or `(…)`,
 * because "Seth Lloyd (Owner, tech advisory)" is one person and
 * `"Doe, Jane" <j@x.com>` is one address. The same reason
 * `parseAddressList` carries its own splitter.
 */
function splitSeeds(raw: string): string[] {
  const out: string[] = []
  let depth = 0
  let quoted = false
  let cur = ''
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && (ch === '<' || ch === '(' || ch === '[')) depth++
    else if (!quoted && (ch === '>' || ch === ')' || ch === ']')) depth = Math.max(0, depth - 1)
    if (!quoted && depth <= 0 && (ch === ',' || ch === ';' || ch === '\n')) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** Header noise a pasted To:/Cc: line brings with it. */
const HEADER_PREFIX = /^(to|cc|bcc|from|subject)\s*:\s*/i

export function parseSeeds(raw: string): PersonSeed[] {
  const seeds: PersonSeed[] = []
  const seen = new Set<string>()

  for (const token of splitSeeds(raw)) {
    const cleaned = token.replace(HEADER_PREFIX, '').trim()
    if (!cleaned) continue

    const emailMatch = cleaned.match(EMAIL_RE)
    const email = emailMatch ? emailMatch[0].toLowerCase() : null

    // A parenthesised tail is a role hint, not part of the name.
    const hintMatch = cleaned.match(/\(([^)]{2,80})\)/)
    const hint = hintMatch ? hintMatch[1].trim() : null

    let name = cleaned
      .replace(/<[^>]*>/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(EMAIL_RE, ' ')
      .replace(/["']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    // "Owner of tech advisory firm" with no name at all is a hint, not a person.
    if (!name && hint) name = ''
    if (!email && !name) continue

    const key = email ?? name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    seeds.push({ email, name: name || null, hint, raw: cleaned })
  }

  return seeds
}

// ── 2. Stored-mail resolution ────────────────────────────────────────────────

interface StoredThread {
  id: string
  subject: string | null
  mailbox: string
  participants: string[]
  first_at: string | null
  last_at: string | null
  message_count: number | null
  raw_markdown: string | null
}

const THREAD_COLS = 'id, subject, mailbox, participants, first_at, last_at, message_count, raw_markdown'
/** Per-person evidence ceiling. Newest threads win; older ones only count. */
const MAX_THREADS_PER_PERSON = 25

async function threadsForEmail(email: string): Promise<StoredThread[]> {
  const db = sweepDb()
  // Array containment hits idx_email_threads_participants. Safe to lowercase
  // the needle: parseAddressList lowercases every address before it is stored.
  const { data, error } = await db
    .from('email_threads')
    .select(THREAD_COLS)
    .contains('participants', [email.toLowerCase()])
    .order('last_at', { ascending: false })
    .limit(MAX_THREADS_PER_PERSON)
  if (error) {
    console.error(`[people-intake] thread lookup failed for ${email}:`, error.message)
    return []
  }
  return (data ?? []) as StoredThread[]
}

/** `### 2026-09-23 20:55 — Seth Lloyd <seth.lloyd@elitesolutions.tech>` and
 *  the quoted `From:`/`To:` headers underneath it. */
const NAMED_ADDRESS_RE = /([^<>;,\n]{2,60}?)\s*<([^<>\s]+@[^<>\s]+)>/g

/**
 * Scrape the label and heading chrome off a captured display name.
 *
 * The capture runs back to the previous delimiter, which in rendered mail is
 * whatever precedes the name: a quoted header's `To:`, or the whole
 * `### 2026-09-08 17:34 —` message heading. Left in, those become the person's
 * name — the first run of this filed a contact as "To: Cliff Barbarick".
 */
function cleanDisplayName(raw: string): string {
  return raw
    // The rendered message heading, up to and including its em dash.
    .replace(/^#{1,6}\s*[\d:\s-]*[—–-]\s*/, '')
    // Quoted header labels, however many deep ("> > From:").
    .replace(/^(?:[>\s*|]*\b(?:to|cc|bcc|from|sent|subject|reply-to)\s*:\s*)+/i, '')
    .replace(/^[\s—–\-·|>*_]+/, '')
    .replace(/[\s,;]+$/, '')
    .replace(/^"(.*)"$/, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A captured "name" that is really a signature-block label.
 *
 * Signatures write their own address as `Email: sterling <mailto:sterling@…>`,
 * and the capture in front of the angle brackets then reads "Email:sterling" —
 * which went on to be offered as somebody's name.
 */
const LABEL_NAME_RE = /^(e-?mail|mail|web|site|url|tel|phone|mobile|cell|direct|office|fax|http|www)\b/i

/** Every name↔address pairing a thread's text asserts. */
function namedAddressesIn(markdown: string): Map<string, Set<string>> {
  const byEmail = new Map<string, Set<string>>()
  for (const m of markdown.matchAll(NAMED_ADDRESS_RE)) {
    const name = cleanDisplayName(m[1])
    // `<mailto:…>` and `<…>` are the same address written two ways.
    const email = m[2].toLowerCase().replace(/^mailto:/, '')
    // A name that is itself an address, a label, or a bare date left over from
    // a heading identifies nobody.
    if (!name || name.includes('@') || name.includes(':') || !/[a-z]/i.test(name)) continue
    if (LABEL_NAME_RE.test(name)) continue
    if (!byEmail.has(email)) byEmail.set(email, new Set())
    byEmail.get(email)!.add(name)
  }
  return byEmail
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

/** Does `candidate` plausibly name the same person as `wanted`? */
function nameMatches(wanted: string, candidate: string): boolean {
  const w = nameTokens(wanted)
  const c = nameTokens(candidate)
  if (w.length === 0 || c.length === 0) return false
  // Every token asked for must appear. "Seth" matches "Seth Lloyd";
  // "Seth Lloyd" does not match "Seth Barnes".
  return w.every((t) => c.includes(t))
}

/**
 * Every address the corpus has ever seen.
 *
 * PAGED, and that is the whole point: PostgREST silently truncates at 1,000
 * rows, so a single select over `email_threads` reads about 40% of the corpus
 * and reports nothing wrong. The first version of this was capped at 1,000 and
 * could not find `jarenldavis@gmail.com` — the land owner on a live deal — for
 * exactly that reason. §12: paginate any select that could exceed it.
 */
async function allParticipants(): Promise<Set<string>> {
  const db = sweepDb()
  const out = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('email_threads')
      .select('participants')
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('[people-intake] participant scan failed:', error.message)
      break
    }
    for (const r of (data ?? []) as { participants: string[] | null }[]) {
      for (const p of r.participants ?? []) out.add(p)
    }
    if (!data || data.length < PAGE) break
  }
  return out
}

/** Character-bigram Dice coefficient — cheap, and good at one-letter drift. */
function diceSimilarity(a: string, b: string): number {
  const bigrams = (s: string) => {
    const out = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
    return out
  }
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const g of A) if (B.has(g)) shared++
  return (2 * shared) / (A.size + B.size)
}

/** Letters only, so "jaren.l.davis" and "Jaren Davis" compare as one string. */
function comparable(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * Anything within a letter or two of the name asked for.
 *
 * 0.58 is calibrated, not guessed. Scored against all 652 distinct addresses in
 * the corpus:
 *
 *   Jerren Davis   -> jarenldavis@gmail.com          0.60  (the real miss)
 *   Seth Loyd      -> seth.lloyd@elitesolutions.tech 0.93
 *   Chip Hoisington-> choisington@goavant.net        0.87
 *   Trever Burton  -> trevor.burton@…                0.82
 *   Peter Callowhil-> pcallowhill@goavant.net        0.73
 *   Michael Zzzzson-> nothing at all
 *
 * The threshold has to sit below 0.60 to catch the case this exists for, and
 * that admits the odd false friend — "Robert Smith" reaches `tsmith@` at 0.67.
 * That is the right trade here because a near miss is only ever SUGGESTED: the
 * reviewer reads "closest in the mail" and ignores it. An auto-resolve at this
 * confidence would be indefensible, which is why there isn't one.
 */
function nearMisses(
  name: string,
  addresses: Set<string>,
  textRows: { raw_markdown: string | null }[]
): { email: string; names: string[] }[] {
  const wanted = comparable(name)
  if (wanted.length < 5) return []
  const THRESHOLD = 0.58

  const byEmail = new Map<string, { names: Set<string>; score: number }>()
  const consider = (email: string, displayName: string | null, candidate: string) => {
    const score = diceSimilarity(wanted, comparable(candidate))
    if (score < THRESHOLD) return
    const entry = byEmail.get(email) ?? { names: new Set<string>(), score: 0 }
    if (displayName) entry.names.add(displayName)
    entry.score = Math.max(entry.score, score)
    byEmail.set(email, entry)
  }

  // Display names first — they are the same shape as what was typed.
  for (const r of textRows) {
    if (!r.raw_markdown) continue
    for (const [email, names] of namedAddressesIn(r.raw_markdown)) {
      for (const n of names) consider(email, n, n)
    }
  }
  // Then the address local parts, for people who never signed with a name.
  for (const a of addresses) {
    if (isNoiseAddress(a)) continue
    consider(a, null, a.split('@')[0])
  }

  return [...byEmail.entries()]
    .sort((x, y) => y[1].score - x[1].score)
    .slice(0, 4)
    .map(([email, e]) => ({ email, names: [...e.names] }))
}

export interface NameResolution {
  email: string | null
  display_name: string | null
  /** Distinct addresses whose display name fits — >1 means refuse. */
  options: { email: string; names: string[] }[]
  /** Why it refused, phrased for the reviewer. Null when it resolved. */
  reason: string | null
}

/** Words in a role hint that say nothing about which firm someone is at. */
const HINT_STOPWORDS = new Set([
  'the', 'of', 'and', 'for', 'at', 'a', 'an', 'owner', 'exec', 'executive',
  'president', 'vice', 'vp', 'ceo', 'cfo', 'coo', 'cto', 'director', 'manager',
  'partner', 'principal', 'lead', 'head', 'founder', 'rep', 'reps',
  'representative', 'firm', 'company', 'co', 'inc', 'llc', 'group', 'land',
  'tech', 'advisory', 'consultant', 'contact', 'broker', 'agent',
])

function hintTokens(hint: string | null | undefined): string[] {
  if (!hint) return []
  return hint
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !HINT_STOPWORDS.has(t))
}

/**
 * Resolve a bare name to an address using the mail itself.
 *
 * Two passes, cheapest first: the address local-part (`seth.lloyd@` carries
 * both tokens), then the display names written in the stored markdown.
 *
 * It refuses more often than it resolves, on purpose. Two rules earn their
 * keep, and the first run of this feature broke both:
 *
 *   - A SINGLE given name never auto-resolves. "Cliff" found exactly one
 *     `Cliff` in 2,400 threads — an academic at a university, with no
 *     connection to the deal — and a lone match is not a unique one, it is an
 *     unchallenged one. One wrong contact filed against a deal is worse than a
 *     row saying "we could not find Cliff".
 *   - A tie is returned, never broken. §12: ambiguity must mean NO match.
 *
 * A role hint ("Avant executive") is used only to NARROW an existing candidate
 * set, never to widen it, and only when it lands on exactly one.
 */
export async function resolveNameToEmail(
  name: string,
  opts: { hint?: string | null } = {}
): Promise<NameResolution> {
  const db = sweepDb()
  const tokens = nameTokens(name)
  const none = (reason: string | null, options: NameResolution['options'] = []) =>
    ({ email: null, display_name: null, options, reason })
  if (tokens.length === 0) return none('That is not a name.')

  // Pass 1 — local-part match over the distinct participant list. Small
  // (652 addresses across 2,436 threads at the time of writing), so this is a
  // cheap in-memory scan once the rows are actually all here.
  const addresses = await allParticipants()

  const localHits = [...addresses].filter((a) => {
    const local = a.split('@')[0].replace(/[._-]+/g, ' ')
    return tokens.every((t) => local.includes(t))
  })

  // Pass 2 — display names in the rendered text. Catches "Chip Hoisington"
  // behind `choisington@`, which no local-part rule would ever find.
  const nameHits = new Map<string, Set<string>>()
  const probe = tokens[tokens.length - 1]
  const { data: textRows } = await db
    .from('email_threads')
    .select('raw_markdown')
    .ilike('raw_markdown', `%${probe}%`)
    .order('last_at', { ascending: false })
    .limit(200)
  for (const r of (textRows ?? []) as { raw_markdown: string | null }[]) {
    if (!r.raw_markdown) continue
    for (const [email, names] of namedAddressesIn(r.raw_markdown)) {
      for (const n of names) {
        if (!nameMatches(name, n)) continue
        if (!nameHits.has(email)) nameHits.set(email, new Set())
        nameHits.get(email)!.add(n)
      }
    }
  }

  for (const a of localHits) if (!nameHits.has(a)) nameHits.set(a, new Set())

  const options = [...nameHits.entries()].map(([email, names]) => ({ email, names: [...names] }))

  // Nothing matched exactly — try near misses before giving up. A name is
  // routinely remembered one letter off ("Jerren Davis" for the Jaren Davis the
  // mail actually holds), and that is precisely the person being looked for.
  // These are only ever SUGGESTED: a spelling that does not match is not
  // evidence of identity, so the human picks.
  if (options.length === 0) {
    const near = nearMisses(name, addresses, textRows ?? [])
    if (near.length === 0) return none(null)
    return none(
      `No exact match for "${name}". Closest in the mail: ` +
        near.map((n) => `${n.names[0] ? `${n.names[0]} <${n.email}>` : n.email}`).join(', ') +
        '. Use the address if one of those is them.',
      near
    )
  }

  // Narrow by hint — domain or display name carrying a distinctive hint word.
  const hints = hintTokens(opts.hint)
  const narrowed = hints.length > 0
    ? options.filter((o) => {
        const haystack = `${o.email} ${o.names.join(' ')}`.toLowerCase()
        return hints.some((h) => haystack.includes(h))
      })
    : []

  if (narrowed.length === 1) {
    return { email: narrowed[0].email, display_name: narrowed[0].names[0] ?? null, options, reason: null }
  }

  // A single given name is too weak to stand on one match.
  if (tokens.length < 2) {
    const where = hints.length > 0 ? ` matching "${opts.hint}"` : ''
    return none(
      `"${name}" is a first name only, so it cannot be matched safely${where} — ` +
        (options.length === 1
          ? `the one address that fits is ${options[0].email}, which may well be someone else entirely. `
          : `${options.length} addresses fit. `) +
        'Add their email address or a surname.',
      options
    )
  }

  if (options.length === 1) {
    return { email: options[0].email, display_name: options[0].names[0] ?? null, options, reason: null }
  }

  return none(
    `"${name}" could be ${options.length} different people in the mail (` +
      options.slice(0, 4).map((o) => o.email).join(', ') +
      '). Add an email address to say which.',
    options
  )
}

// ── 3. Live Gmail top-up ─────────────────────────────────────────────────────

/**
 * Search Gmail directly for a person the stored corpus does not know.
 *
 * The sweep is a cursor, so a counterparty who first wrote last week may not be
 * stored yet. What comes back is persisted through the sweep's own pass, so the
 * next reader — the summarizer, the commitment ledger, Ask Ber AI — sees it too
 * rather than it being read once for this screen and thrown away.
 */
async function topUpFromGmail(
  email: string,
  sinceDays: number,
  notes: string[]
): Promise<StoredThread[]> {
  if (!isGoogleConfigured()) return []
  try {
    const result = await searchThreads(email, { sinceDays, maxThreads: 10 })
    for (const n of result.notes) notes.push(n)
    if (result.threads.length === 0) return []

    try {
      await storeFetchedThreads(result.threads)
    } catch (err) {
      // Worth surfacing but never fatal: the draft can still be built from
      // what was just fetched, it simply will not be there next time.
      notes.push(
        `Threads for ${email} were read from Gmail but could not be stored (${
          err instanceof Error ? err.message.slice(0, 120) : 'error'
        }).`
      )
    }

    return result.threads.map((t) => ({
      id: t.fingerprint,
      subject: t.subject,
      mailbox: t.mailbox,
      participants: t.participants,
      first_at: t.firstAt,
      last_at: t.lastAt,
      message_count: t.messages.length,
      raw_markdown: renderThread(t),
    }))
  } catch (err) {
    notes.push(
      `Gmail could not be searched for ${email} (${
        err instanceof Error ? err.message.slice(0, 160) : 'error'
      }).`
    )
    return []
  }
}

// ── 4. Model extraction ──────────────────────────────────────────────────────

interface ExtractedPerson {
  full_name?: string | null
  title?: string | null
  company?: string | null
  phone?: string | null
  role?: string | null
  summary?: string | null
  commitments?: string[] | null
  works_with?: string[] | null
  other_names?: string[] | null
}

const EXTRACT_SYSTEM = `You read email correspondence and profile ONE person named in it, for a construction and development executive's contact directory.

Rules:
- Extract only what the correspondence actually shows. Never infer, complete, or guess a value. A field you cannot fill is null.
- Signature blocks are the most reliable evidence: a person's own signature states their title, employer and direct phone. Prefer it over anything implied by the body.
- Do not attribute a colleague's title, phone or employer to this person. Several people appear in these threads; profile only the one named in the instruction.
- "role" is what this person is DOING in this correspondence for the deal at hand — "land owner", "introducing broker", "engineering lead" — not their job title.
- Quote nothing verbatim at length. Write plainly.
Return ONLY valid JSON. No explanation. No markdown fences.`

function extractPrompt(who: string, evidence: string, hint: string | null): string {
  return `Profile this person: ${who}
${hint ? `The person who asked for this profile describes them as: "${hint}". Treat that as a hint to confirm or correct from the mail, never as a fact.\n` : ''}
Return JSON with exactly these keys:
- full_name (string) — their name as they themselves write it in a signature, with credentials that follow it ("Marcus Delgado, P.E.")
- title (string) — their job title
- company (string) — the organization they work for
- phone (string) — their direct or mobile number, from their own signature
- role (string) — what they are doing in THIS correspondence (see rules)
- summary (string) — two or three sentences: who they are and what they have actually done in this mail
- commitments (array of strings) — obligations THIS person took on or is owed, in the mail's own terms ("sending the NDA before the meeting")
- works_with (array of strings) — other people's names this person appears alongside
- other_names (array of strings) — any other spelling or form of their name that appears ("Jerren Davis" where the address says Jaren)

CORRESPONDENCE:
${evidence}`
}

/** Render the evidence the model reads, newest thread first, inside budget. */
function buildEvidence(threads: StoredThread[], budget: number): string {
  const parts: string[] = []
  let used = 0
  for (const t of threads) {
    const text = t.raw_markdown?.trim()
    if (!text) continue
    if (used + text.length > budget) {
      // Newest-first, so the tail is the least informative. A partial last
      // thread beats a hard stop: signatures live at the top of a message.
      const room = budget - used
      if (room > 1500) {
        parts.push(text.slice(0, room) + '\n[… thread truncated]')
        used = budget
      }
      break
    }
    parts.push(text)
    used += text.length + 2
  }
  return parts.join('\n\n---\n\n')
}

// ── 5. Directory matching ────────────────────────────────────────────────────

interface DirectoryMatch {
  existing_party_id: string | null
  existing_party_name: string | null
  match_type: PersonProfileDraft['match_type']
  ambiguous: boolean
  candidates: PartyCandidate[]
}

const NO_MATCH: DirectoryMatch = {
  existing_party_id: null,
  existing_party_name: null,
  match_type: 'none',
  ambiguous: false,
  candidates: [],
}

/**
 * Find the contact this person already is, if any.
 *
 * Email is identity and wins outright. A name is a guess, so a name match that
 * is not unique comes back `ambiguous` with its candidates and NO chosen id —
 * the review screen then asks instead of quietly merging two people.
 */
async function matchDirectory(
  email: string | null,
  name: string | null,
  company: string | null
): Promise<DirectoryMatch> {
  const db = createAdminClient()

  if (email) {
    const { data } = await db
      .from('parties')
      .select('id, full_name, company, email')
      .ilike('email', email)
      .limit(2)
    if (data && data.length === 1) {
      return {
        existing_party_id: data[0].id,
        existing_party_name: data[0].full_name,
        match_type: 'exact_email',
        ambiguous: false,
        candidates: data,
      }
    }
    if (data && data.length > 1) {
      // Two contacts holding one address is a duplicate to resolve, not a match.
      return { ...NO_MATCH, ambiguous: true, candidates: data }
    }
  }

  if (!name) return NO_MATCH

  const { data: byName } = await db
    .from('parties')
    .select('id, full_name, company, email')
    .ilike('full_name', name)
    .limit(5)
  if (byName && byName.length === 1) {
    return {
      existing_party_id: byName[0].id,
      existing_party_name: byName[0].full_name,
      match_type: 'exact_name',
      ambiguous: false,
      candidates: byName,
    }
  }
  if (byName && byName.length > 1) {
    // Same name, different people — unless the company settles it.
    const narrowed = company
      ? byName.filter((p) => (p.company ?? '').toLowerCase() === company.toLowerCase())
      : []
    if (narrowed.length === 1) {
      return {
        existing_party_id: narrowed[0].id,
        existing_party_name: narrowed[0].full_name,
        match_type: 'exact_name',
        ambiguous: false,
        candidates: byName,
      }
    }
    return { ...NO_MATCH, ambiguous: true, candidates: byName }
  }

  const { data: fuzzy } = (await db.rpc('match_parties_by_name', {
    search_name: name,
    threshold: 0.4,
  })) as unknown as { data: Array<{ id: string; full_name: string; similarity: number }> | null }

  if (fuzzy?.length) {
    // Within 0.05 of each other is a tie, not a winner.
    const tied = fuzzy.length > 1 && fuzzy[1].similarity >= fuzzy[0].similarity - 0.05
    const candidates: PartyCandidate[] = fuzzy.slice(0, 5).map((f) => ({
      id: f.id,
      full_name: f.full_name,
      company: null,
      email: null,
    }))
    if (tied) return { ...NO_MATCH, ambiguous: true, candidates }
    return {
      existing_party_id: fuzzy[0].id,
      existing_party_name: fuzzy[0].full_name,
      match_type: 'fuzzy_name',
      ambiguous: false,
      candidates,
    }
  }

  return NO_MATCH
}

// ── 6. Cast fan-out ──────────────────────────────────────────────────────────

/** Addresses that are never a person worth filing. */
const NOISE_LOCALPARTS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'notifications', 'notification',
  'calendar-notification', 'mailer-daemon', 'postmaster', 'bounce', 'bounces',
  'support', 'info', 'sales', 'billing', 'invoices', 'accounts', 'admin',
  'marketing', 'newsletter', 'news', 'updates', 'automated', 'alerts',
]

/**
 * Above this many participants a thread is a distribution list, not a
 * conversation, and its recipients are not a cast.
 *
 * Measured: of 2,436 stored threads, 2,391 have 5 participants or fewer and the
 * largest real deal conversation has 11. The two that wrecked the first run of
 * this feature were a 35- and a 36-recipient "AVANT Mobility Solution Lunch &
 * Learn" invite, which buried the five people who mattered under thirty
 * strangers from a networking breakfast. 15 clears every real thread in the
 * corpus and catches both blasts.
 */
const MAX_CAST_PARTICIPANTS = 15

function isNoiseAddress(email: string): boolean {
  const [local, domain] = email.split('@')
  if (!local || !domain) return true
  if (NOISE_LOCALPARTS.some((n) => local === n || local.startsWith(`${n}+`) || local.startsWith(`${n}-`))) return true
  if (/^(reply|bounce)[.+-]/.test(local)) return true
  // Our own people are team members, not counterparties to file. Matched
  // loosely because real mail carries typos of it — `tuaone@berwilson`, with
  // the TLD dropped, appeared in the corpus and was offered as a contact.
  if (/^berwilson(\.|$)/.test(domain)) return true
  return false
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface BuildDraftOptions {
  seeds: PersonSeed[]
  userId: string
  sinceDays?: number
  /** Skip the grounded web pass — mail only. */
  skipWeb?: boolean
}

/**
 * Build the reviewable draft. Never throws for one person's sake: a seed that
 * resolves to nothing comes back as a row carrying the reason, because "we
 * found nothing about Cliff" is a useful answer and a silent omission is not.
 */
export async function buildProfileDrafts(opts: BuildDraftOptions): Promise<ProfileIntakeDraft> {
  const { seeds, userId } = opts
  const sinceDays = opts.sinceDays && opts.sinceDays > 0 ? opts.sinceDays : 3650
  const notes: string[] = []
  const people: PersonProfileDraft[] = []

  // Per-person slice of the model's input budget, leaving room for the prompt
  // and — on the local model — its reasoning tokens inside the same window.
  const evidenceBudget = Math.min(18_000, Math.floor(maxInputChars() * 0.45))

  const threadsByPerson = new Map<string, StoredThread[]>()
  let fetchedLive = 0

  for (const [i, seed] of seeds.entries()) {
    const ref = `p${i}`
    let email = seed.email
    let displayName: string | null = null
    let note: string | null = null
    const aliases = new Set<string>()
    if (seed.name) aliases.add(seed.name)

    // ── resolve a bare name to an address ──
    if (!email && seed.name) {
      const resolved = await resolveNameToEmail(seed.name, { hint: seed.hint })
      if (resolved.email) {
        email = resolved.email
        displayName = resolved.display_name
      } else {
        note =
          resolved.reason ??
          `No mail in ${MAILBOXES.join(' or ')} names "${seed.name}". Add their email address, or create the contact by hand.`
      }
    }

    // ── gather evidence ──
    let threads: StoredThread[] = []
    if (email) {
      threads = await threadsForEmail(email)
      if (threads.length === 0) {
        const live = await topUpFromGmail(email, sinceDays, notes)
        fetchedLive += live.length
        threads = live
        if (threads.length === 0) {
          note = `No correspondence with ${email} in ${MAILBOXES.join(' or ')}. The profile below is from the web only.`
        }
      }
      threadsByPerson.set(email, threads)
    }

    // Display name from the headers — the most reliable name there is.
    if (email && !displayName) {
      for (const t of threads) {
        if (!t.raw_markdown) continue
        const names = namedAddressesIn(t.raw_markdown).get(email)
        if (names && names.size > 0) {
          for (const n of names) aliases.add(n)
          displayName ??= [...names][0]
        }
      }
    }

    // ── extract from the mail ──
    let extracted: ExtractedPerson = {}
    const evidence = buildEvidence(threads, evidenceBudget)
    if (evidence) {
      const who = [displayName ?? seed.name, email ? `<${email}>` : null].filter(Boolean).join(' ')
      try {
        const result = await callGemini<ExtractedPerson>({
          task: 'extract',
          systemPrompt: EXTRACT_SYSTEM,
          userMessage: extractPrompt(who || (email ?? 'this person'), evidence, seed.hint),
          userId,
          promptVersion: 'people-intake-1.0',
          maxTokens: 2048,
        })
        if (result.data && typeof result.data === 'object') extracted = result.data
      } catch (err) {
        notes.push(
          `Ber AI could not read the correspondence for ${who || email || seed.raw} (${
            err instanceof Error ? err.message.slice(0, 140) : 'error'
          }) — the row below carries the mail it found but no extracted profile.`
        )
      }
    }

    for (const n of extracted.other_names ?? []) if (n) aliases.add(String(n))

    // ── Google Contacts + web ──
    const mailName = extracted.full_name?.trim() || displayName || seed.name || null
    const mailCompany = extracted.company?.trim() || null
    const dir = email ? await lookupDirectoryContact(email) : null
    const web = opts.skipWeb || !mailName
      ? { structured: {}, sources: [], researched: false, error: null as string | null }
      : await researchPersonWeb({ fullName: mailName, company: mailCompany ?? dir?.companyName, userId })

    // ── directory match ──
    const match = await matchDirectory(email, mailName, mailCompany ?? dir?.companyName ?? null)

    const dates = threads.map((t) => t.last_at).filter((d): d is string => Boolean(d)).sort()
    const firsts = threads.map((t) => t.first_at).filter((d): d is string => Boolean(d)).sort()

    const evidenceKind: PersonProfileDraft['evidence'] =
      threads.length > 0 ? 'mail' : dir ? 'directory' : web.researched ? 'web' : 'none'

    people.push({
      ref,
      seed,
      email,
      display_name: displayName,
      // Mail beats directory beats web, at every field.
      full_name: mailName ?? dir?.displayName ?? null,
      title: extracted.title?.trim() || dir?.jobTitle || null,
      company: mailCompany || dir?.companyName || null,
      phone: extracted.phone?.trim() || directoryPhone(dir) || web.structured.phone || null,
      linkedin_url: web.structured.linkedin_url ?? null,
      role: extracted.role?.trim() || seed.hint || null,
      summary: extracted.summary?.trim() || null,
      commitments: (extracted.commitments ?? []).map(String).filter(Boolean).slice(0, 10),
      works_with: (extracted.works_with ?? []).map(String).filter(Boolean).slice(0, 12),
      aliases: [...aliases].filter((a) => a.toLowerCase() !== (mailName ?? '').toLowerCase()).slice(0, 6),
      thread_count: threads.length,
      first_seen: firsts[0] ?? null,
      last_seen: dates[dates.length - 1] ?? null,
      threads: threads.slice(0, 10).map((t) => ({
        id: t.id,
        subject: t.subject,
        last_at: t.last_at,
        mailbox: t.mailbox,
        message_count: t.message_count ?? 0,
      })),
      evidence: evidenceKind,
      sources: web.sources,
      researched: web.researched,
      research_error: web.error,
      existing_party_id: match.existing_party_id,
      existing_party_name: match.existing_party_name,
      match_type: match.match_type,
      ambiguous: match.ambiguous,
      candidates: match.candidates,
      note,
    })
  }

  const cast = await buildCast(threadsByPerson, seeds)

  const threadsRead = new Set<string>()
  for (const list of threadsByPerson.values()) for (const t of list) threadsRead.add(t.id)

  return {
    people,
    cast,
    notes,
    stats: {
      threads_read: threadsRead.size,
      threads_fetched_live: fetchedLive,
      mailboxes: [...MAILBOXES],
    },
  }
}

/**
 * Everyone else in the same correspondence.
 *
 * Ranked by two signals, in order: how many of the seeds' threads someone
 * appears in, and whether they share a mail domain with one of the seeds. The
 * second matters more than it looks — it is what floats the other side's own
 * team to the top of the list, which is the question actually being asked
 * ("and whoever their reps turn out to be").
 *
 * Already-known contacts are kept rather than dropped: seeing that a name IS
 * on file is as useful as seeing that it is not.
 */
async function buildCast(
  threadsByPerson: Map<string, StoredThread[]>,
  seeds: PersonSeed[]
): Promise<CastCandidate[]> {
  const seedEmails = new Set(
    [...threadsByPerson.keys(), ...seeds.map((s) => s.email).filter(Boolean)] as string[]
  )
  const seedDomains = new Set(
    [...seedEmails].map((e) => e.split('@')[1]).filter((d): d is string => Boolean(d))
  )

  const counts = new Map<string, { threads: Set<string>; subjects: string[]; names: Set<string> }>()
  for (const threads of threadsByPerson.values()) {
    for (const t of threads) {
      // A blast tells you nothing about who is on a deal.
      if ((t.participants?.length ?? 0) > MAX_CAST_PARTICIPANTS) continue
      const named = t.raw_markdown ? namedAddressesIn(t.raw_markdown) : new Map<string, Set<string>>()
      for (const p of t.participants ?? []) {
        const email = p.toLowerCase()
        if (seedEmails.has(email) || isNoiseAddress(email)) continue
        if (!counts.has(email)) counts.set(email, { threads: new Set(), subjects: [], names: new Set() })
        const entry = counts.get(email)!
        if (!entry.threads.has(t.id)) {
          entry.threads.add(t.id)
          if (t.subject && entry.subjects.length < 4) entry.subjects.push(t.subject)
        }
        for (const n of named.get(email) ?? []) entry.names.add(n)
      }
    }
  }

  if (counts.size === 0) return []

  // One query for the whole cast rather than one per address.
  const emails = [...counts.keys()]
  const db = createAdminClient()
  const known = new Map<string, { id: string; full_name: string }>()
  const PAGE = 200
  for (let i = 0; i < emails.length; i += PAGE) {
    const { data } = await db
      .from('parties')
      .select('id, full_name, email')
      .in('email', emails.slice(i, i + PAGE))
    for (const p of data ?? []) {
      if (p.email) known.set(p.email.toLowerCase(), { id: p.id, full_name: p.full_name })
    }
  }

  return [...counts.entries()]
    .map(([email, entry]) => {
      const hit = known.get(email)
      const domain = email.split('@')[1] ?? ''
      const candidate: CastCandidate = {
        email,
        display_name: [...entry.names][0] ?? null,
        domain,
        thread_count: entry.threads.size,
        subjects: entry.subjects,
        existing_party_id: hit?.id ?? null,
        existing_party_name: hit?.full_name ?? null,
      }
      // Ranking only — kept beside the candidate rather than on it, so the
      // shape that reaches the reviewer carries nothing it should not.
      return { candidate, colleague: seedDomains.has(domain) }
    })
    .sort(
      (a, b) =>
        Number(b.colleague) - Number(a.colleague) ||
        b.candidate.thread_count - a.candidate.thread_count ||
        a.candidate.email.localeCompare(b.candidate.email)
    )
    .slice(0, 40)
    .map((r) => r.candidate)
}
