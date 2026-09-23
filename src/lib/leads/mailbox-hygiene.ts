/**
 * Keeping the lead mailbox clean — unsubscribe from marketing, spam the rest.
 *
 * Richard, 2026-09-22: "You are in charge of the info@berwilson.com email to
 * keep it clean. We only want to consider leads, rfp's, etc... get rid of
 * everything else." The deal mailboxes are explicitly NOT in scope — Eric and
 * Richard manage those themselves, and the platform holds read-only Gmail
 * scopes there anyway.
 *
 * Two actions, in this order and for a reason:
 *  1. UNSUBSCRIBE, which stops the mail at its source. The only action here
 *     that reduces what arrives rather than hiding it after the fact.
 *  2. SPAM, which takes the existing backlog out of the inbox and teaches Gmail
 *     to keep doing it. Fully reversible — a thread moved to SPAM keeps every
 *     other label and can be moved back — but it IS auto-deleted after 30 days,
 *     which is why classifySender protects so aggressively.
 *
 * ⚠ SCANS `in:inbox`, WHICH MAKES IT SELF-LIMITING AND NEEDS NO STATE. A thread
 * moved to SPAM leaves the scan, so nothing is reconsidered and no ledger of
 * "already handled" has to be kept anywhere. If a sender ignores the
 * unsubscribe and mails again, they reappear in the scan and are unsubscribed
 * again — which is the correct response, not a bug.
 */

import { getAccessToken } from '@/lib/integrations/google-workspace'
import { leadsDb } from '@/lib/leads/db'
import { classifySender, senderFamily, type SenderVerdict } from './junk-senders'
import { unsubscribeOneClick } from './unsubscribe'

const MAILBOX = 'info@berwilson.com'
const API = 'https://gmail.googleapis.com/gmail/v1/users'

/** Gmail meters by cost-units-per-MINUTE; an unpaced run exhausts it. */
const PACE_MS = 90

export interface HygieneProgress {
  threadsScanned: number
  families: number
  junkFamilies: number
  protectedFamilies: number
  unknownFamilies: number
  unsubscribed: number
  unsubscribeFailed: number
  threadsSpammed: number
  /**
   * What was decided, for the operator.
   *
   * Carries the thread ids so a DRY RUN produces an actionable plan rather than
   * a report: reviewing 8,045 threads costs a 35-minute scan, and doing it twice
   * (once to decide, once to act) means the second pass could decide differently
   * from the one that was reviewed.
   */
  decisions: Array<{
    family: string
    verdict: SenderVerdict
    reason: string
    threads: number
    threadIds: string[]
    sample: string
  }>
  errors: string[]
  outOfTime: boolean
  dryRun: boolean
}

interface ThreadFacts {
  id: string
  address: string
  listUnsubscribe: string | null
  listUnsubscribePost: string | null
}

/**
 * Whole-inbox scan by default; a window for the routine pass.
 *
 * The backfill wants everything (7,613 of 8,045 threads predate the lead
 * sweep's 90-day horizon and have never been looked at). The daily pass wants a
 * window, because after the backfill the inbox is small and only new arrivals
 * can have changed.
 */
export async function runMailboxHygiene(
  opts: {
    sinceDays?: number | null
    budgetMs?: number
    dryRun?: boolean
    maxThreads?: number
    /** Skip the outward-facing half and only file mail. */
    unsubscribe?: boolean
  } = {}
): Promise<HygieneProgress> {
  const deadline = Date.now() + (opts.budgetMs ?? 20 * 60 * 1000)
  const dryRun = opts.dryRun ?? false
  const progress: HygieneProgress = {
    threadsScanned: 0, families: 0, junkFamilies: 0, protectedFamilies: 0,
    unknownFamilies: 0, unsubscribed: 0, unsubscribeFailed: 0, threadsSpammed: 0,
    decisions: [], errors: [], outOfTime: false, dryRun,
  }

  let token = await getAccessToken(MAILBOX)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  /**
   * Gmail call with retry.
   *
   * Network-level failures (EHOSTUNREACH, "fetch failed") escape a status-only
   * retry loop entirely — the gap that used to kill whole Drive syncs on this
   * box, and that killed the first run of this very scan.
   */
  async function call<T>(path: string, init?: RequestInit, tries = 5): Promise<T> {
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(`${API}/${encodeURIComponent(MAILBOX)}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
          signal: AbortSignal.timeout(30_000),
        })
        if (res.ok) return (await res.json()) as T
        if (res.status === 401) { token = await getAccessToken(MAILBOX); continue }
        if (res.status === 429 || res.status === 403 || res.status >= 500) { await sleep(2000 * (i + 1)); continue }
        throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 160)}`)
      } catch (err) {
        const m = String(err)
        if (i === tries - 1 || !/fetch failed|EHOSTUNREACH|ENOTFOUND|ECONNRESET|abort|timeout/i.test(m)) throw err
        await sleep(3000 * (i + 1))
      }
    }
    throw new Error('Gmail: retries exhausted')
  }

  // ── 1. What is in the inbox ───────────────────────────────────────────────
  const q = opts.sinceDays ? `in:inbox newer_than:${opts.sinceDays}d` : 'in:inbox'
  const threadIds: string[] = []
  let page: string | undefined
  do {
    const d = await call<{ threads?: { id: string }[]; nextPageToken?: string }>(
      `/threads?maxResults=500&q=${encodeURIComponent(q)}${page ? `&pageToken=${page}` : ''}`
    )
    threadIds.push(...(d.threads ?? []).map((t) => t.id))
    page = d.nextPageToken
  } while (page && threadIds.length < (opts.maxThreads ?? 20_000))

  // ── 2. Who sent them, and is it list mail ─────────────────────────────────
  const facts: ThreadFacts[] = []
  for (const id of threadIds.slice(0, opts.maxThreads ?? threadIds.length)) {
    if (Date.now() >= deadline) { progress.outOfTime = true; break }
    try {
      const d = await call<{ messages?: { payload?: { headers?: { name: string; value: string }[] } }[] }>(
        `/threads/${id}?format=metadata&metadataHeaders=From` +
        '&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Unsubscribe-Post'
      )
      const h = d.messages?.[0]?.payload?.headers ?? []
      const hv = (n: string) => h.find((x) => x.name.toLowerCase() === n)?.value ?? null
      const from = hv('from') ?? ''
      facts.push({
        id,
        address: (from.match(/<([^>]+)>/)?.[1] ?? from).toLowerCase().trim(),
        listUnsubscribe: hv('list-unsubscribe'),
        listUnsubscribePost: hv('list-unsubscribe-post'),
      })
      progress.threadsScanned++
    } catch (err) {
      if (progress.errors.length < 10) progress.errors.push(`${id}: ${String(err).slice(0, 120)}`)
    }
    await sleep(PACE_MS)
  }

  // ── 3. Evidence that protects a sender ────────────────────────────────────
  const producers = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await leadsDb().from('leads')
      .select('sender_email, status').neq('status', 'spam').range(from, from + 999)
    for (const r of (data ?? []) as { sender_email: string | null }[]) {
      if (r.sender_email) producers.add(senderFamily(r.sender_email))
    }
    if (!data || data.length < 1000) break
  }

  // A thread already filed onto a record is evidence about its sender that no
  // header carries — a vendor newsletter from a firm we are actively working
  // with must not be spammed.
  const linked = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await leadsDb().from('thread_links')
      .select('thread:email_threads(gmail_thread_id)').range(from, from + 999)
    // PostgREST types a to-one embed as an array here even though it returns an
    // object, so the shape is normalised rather than asserted away.
    for (const r of (data ?? []) as unknown as {
      thread: { gmail_thread_id: string | null } | { gmail_thread_id: string | null }[] | null
    }[]) {
      const t = Array.isArray(r.thread) ? r.thread[0] : r.thread
      if (t?.gmail_thread_id) linked.add(t.gmail_thread_id)
    }
    if (!data || data.length < 1000) break
  }

  // ── 4. Decide per FAMILY, not per address ─────────────────────────────────
  const fams = new Map<string, { threads: ThreadFacts[]; bulk: boolean; linked: boolean }>()
  for (const f of facts) {
    if (!f.address) continue
    const key = senderFamily(f.address)
    const e = fams.get(key) ?? { threads: [], bulk: false, linked: false }
    e.threads.push(f)
    if (f.listUnsubscribe) e.bulk = true
    if (linked.has(f.id)) e.linked = true
    fams.set(key, e)
  }
  progress.families = fams.size

  for (const [family, e] of fams) {
    if (Date.now() >= deadline) { progress.outOfTime = true; break }

    if (e.linked) {
      progress.protectedFamilies++
      progress.decisions.push({ family, verdict: 'protected', reason: 'filed onto a record',
        threads: e.threads.length, threadIds: e.threads.map((t) => t.id), sample: e.threads[0].address })
      continue
    }

    const { verdict, reason } = classifySender({
      address: e.threads[0].address,
      bulk: e.bulk,
      everProducedLead: producers.has(family),
      threads: e.threads.length,
    })
    progress.decisions.push({ family, verdict, reason, threads: e.threads.length,
      threadIds: e.threads.map((t) => t.id), sample: e.threads[0].address })

    if (verdict === 'protected') { progress.protectedFamilies++; continue }
    if (verdict === 'unknown') { progress.unknownFamilies++; continue }
    progress.junkFamilies++
    if (dryRun) continue

    // Unsubscribe ONCE per family, from whichever of its threads carries a
    // usable one-click endpoint.
    if (opts.unsubscribe !== false) {
      const carrier = e.threads.find((t) => t.listUnsubscribePost && t.listUnsubscribe)
      if (carrier) {
        const r = await unsubscribeOneClick(carrier.listUnsubscribe, carrier.listUnsubscribePost)
        if (r.ok) progress.unsubscribed++
        else {
          progress.unsubscribeFailed++
          if (progress.errors.length < 20) progress.errors.push(`unsub ${family}: ${r.reason}`)
        }
        await sleep(PACE_MS)
      }
    }

    // Then take the backlog out of the inbox.
    for (const t of e.threads) {
      try {
        await call(`/threads/${t.id}/modify`, {
          method: 'POST',
          body: JSON.stringify({ addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] }),
        })
        progress.threadsSpammed++
      } catch (err) {
        if (progress.errors.length < 20) progress.errors.push(`spam ${t.id}: ${String(err).slice(0, 100)}`)
      }
      await sleep(PACE_MS)
    }
  }

  return progress
}
