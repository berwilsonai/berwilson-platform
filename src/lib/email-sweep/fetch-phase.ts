/**
 * Sweep phase 1 — FETCH.
 *
 * Pages through each mailbox's history and persists every thread to
 * email_threads with summary_state='pending'. No AI runs here; this phase is
 * network-bound and finishes in minutes, so the (slow) summarizing phase always
 * has a full backlog to chew on.
 *
 * Resumability is the whole design. Gmail's page token is checkpointed to
 * mailbox_sync after EVERY page, so a crash, reboot, or deploy costs at most
 * one page of re-reading. Re-running after completion picks up only new mail,
 * because a thread already stored IN FULL is skipped on insert.
 *
 * "In full" is doing real work in that sentence. Until 2026-09-09 a stored
 * thread was skipped on identity alone — and its identity is the Message-ID of
 * its FIRST message, so a conversation that had since gained a dozen replies
 * looked exactly like one already seen and its stored copy never changed. A
 * known thread is now skipped only while its message count has not grown.
 */

import {
  sweepPage,
  renderThread,
  leadExclusions,
  type ResolvedThread,
  type KnownThread,
} from '@/lib/integrations/gmail-search'
import { MAILBOXES, LEAD_MAILBOXES } from '@/lib/integrations/google-workspace'
import { sweepDb, type MailboxSyncRow } from './db'

/** Threads per Gmail page. 100 keeps each checkpoint cheap to redo. */
const PAGE_SIZE = 100

/**
 * Catch-up tuning for a mailbox whose backfill already finished.
 *
 * Such a mailbox is NOT done forever — new mail keeps arriving — so each run
 * re-reads a recent window from page one and lets fingerprint dedupe drop
 * everything already stored. The buffer covers clock skew and mail that lands
 * with an older internal date than the run that missed it.
 */
const CATCHUP_BUFFER_DAYS = 2
const CATCHUP_MAX_WINDOW_DAYS = 30
const CATCHUP_MAX_PAGES = 3

/** Days of history a caught-up mailbox should re-read, based on its last pass. */
function catchUpWindowDays(completedAt: string | null): number {
  if (!completedAt) return 7
  const elapsed = Math.ceil((Date.now() - new Date(completedAt).getTime()) / 86_400_000)
  return Math.min(CATCHUP_MAX_WINDOW_DAYS, Math.max(1, elapsed) + CATCHUP_BUFFER_DAYS)
}

export interface FetchProgress {
  mailbox: string
  state: MailboxSyncRow['state']
  pagesThisRun: number
  threadsSeen: number
  threadsNew: number
  /**
   * Threads already stored that gained messages and were refreshed.
   *
   * Counted separately from `threadsNew` because it answers a different
   * question: not "how much mail arrived" but "how much of what we already had
   * was out of date" — which, before this existed, was silently always.
   */
  threadsRefreshed: number
  duplicatesSkipped: number
  done: boolean
  notes: string[]
}

/**
 * Load what is already stored for every thread, so a sweep can tell a
 * cross-mailbox copy (skip) from a conversation that has since grown (refresh).
 *
 * Carries the message count, not just the fingerprint: skipping on identity
 * alone is what froze stored correspondence at first capture.
 */
async function loadKnownThreads(): Promise<Map<string, KnownThread>> {
  const db = sweepDb()
  const known = new Map<string, KnownThread>()

  // Paged — a full backfill can exceed PostgREST's default row ceiling.
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('email_threads')
      .select('fingerprint, message_count')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Could not load known threads: ${error.message}`)
    for (const row of data ?? []) {
      const r = row as { fingerprint: string; message_count: number | null }
      known.set(r.fingerprint, { messageCount: r.message_count ?? 0 })
    }
    if (!data || data.length < PAGE) break
  }
  return known
}

/**
 * Which downstream pipeline owns a thread.
 *
 * 'deal' threads are clustered into pursuits and staged as review sessions.
 * 'lead' threads are triaged and scored one-for-one and never enter that queue.
 * Set at fetch time from which mailbox the thread came out of.
 */
export type ThreadPipeline = 'deal' | 'lead'

interface PersistResult {
  inserted: number
  refreshed: number
}

/**
 * Store this page: insert threads never seen, update ones that have grown.
 *
 * The original guard still holds and matters — a thread already captured from
 * the other mailbox, or on a previous run, must NOT have its summary reset to
 * pending, or every catch-up pass would re-summarize the whole corpus at 25-50s
 * a thread. What changed is the definition of "already captured": identity used
 * to be enough, which meant a conversation could gain a dozen messages and the
 * platform would keep serving the two it first saw.
 *
 * A grown thread DOES go back to pending, deliberately: its summary, its lead
 * and any record update derived from it are all now stale.
 */
async function persistThreads(
  threads: ResolvedThread[],
  pipeline: ThreadPipeline,
  grownFingerprints: Set<string>
): Promise<PersistResult> {
  if (threads.length === 0) return { inserted: 0, refreshed: 0 }
  const db = sweepDb()

  const toRow = (t: ResolvedThread) => ({
    pipeline,
    fingerprint: t.fingerprint,
    mailbox: t.mailbox,
    gmail_thread_id: t.threadId,
    subject: t.subject,
    participants: t.participants,
    first_at: t.firstAt,
    last_at: t.lastAt,
    message_count: t.messages.length,
    attachment_count: t.attachmentCount,
    raw_markdown: renderThread(t),
    summary_state: 'pending' as const,
  })

  const fresh = threads.filter((t) => !grownFingerprints.has(t.fingerprint))
  const grown = threads.filter((t) => grownFingerprints.has(t.fingerprint))

  let inserted = 0
  if (fresh.length > 0) {
    const { data, error } = await db
      .from('email_threads')
      .upsert(fresh.map(toRow), { onConflict: 'fingerprint', ignoreDuplicates: true })
      .select('id')
    if (error) throw new Error(`Could not store threads: ${error.message}`)
    inserted = data?.length ?? 0
  }

  // One at a time rather than a bulk upsert: a bulk upsert without
  // ignoreDuplicates would also reset every unchanged row it touched, and the
  // grown set is small by nature — this is the long tail, not the bulk.
  let refreshed = 0
  for (const t of grown) {
    // pipeline and fingerprint identify the row rather than describing it, so a
    // refresh must not rewrite them.
    const row = toRow(t)
    const patch = {
      mailbox: row.mailbox,
      gmail_thread_id: row.gmail_thread_id,
      subject: row.subject,
      participants: row.participants,
      first_at: row.first_at,
      last_at: row.last_at,
      message_count: row.message_count,
      attachment_count: row.attachment_count,
      raw_markdown: row.raw_markdown,
      summary_state: row.summary_state,
    }
    const { error } = await db
      .from('email_threads')
      // routed_at cleared alongside the summary: a conversation that has grown
      // may now match a record it did not before, and its record update is now
      // short of the new messages either way.
      .update({ ...patch, summary_error: null, routed_at: null })
      .eq('fingerprint', t.fingerprint)
    if (error) {
      console.error(`[sweep/fetch] could not refresh ${t.fingerprint}:`, error.message)
      continue
    }
    refreshed++
  }

  return { inserted, refreshed }
}

async function readSync(mailbox: string): Promise<MailboxSyncRow | null> {
  const db = sweepDb()
  const { data } = await db.from('mailbox_sync').select('*').eq('mailbox', mailbox).maybeSingle()
  return (data as MailboxSyncRow | null) ?? null
}

async function writeSync(mailbox: string, patch: Partial<MailboxSyncRow>): Promise<void> {
  const db = sweepDb()
  const { error } = await db
    .from('mailbox_sync')
    .upsert({ mailbox, ...patch }, { onConflict: 'mailbox' })
  if (error) console.error(`[sweep/fetch] could not checkpoint ${mailbox}:`, error.message)
}

/**
 * Fetch up to `maxPages` pages for one mailbox, checkpointing after each.
 *
 * @param sinceDays  null/undefined = all history. Only honoured on a fresh
 *                   sweep; a resumed one keeps the window it started with, or
 *                   the page token would point into a different result set.
 */
export async function fetchMailbox(
  mailbox: string,
  opts: {
    maxPages?: number
    sinceDays?: number | null
    restart?: boolean
    pipeline?: ThreadPipeline
  } = {}
): Promise<FetchProgress> {
  const pipeline = opts.pipeline ?? 'deal'
  const existing = await readSync(mailbox)
  const notes: string[] = []

  const resuming = !opts.restart && existing?.state === 'running' && !!existing.page_token
  // A mailbox that already finished a pass re-reads a recent window instead of
  // the whole history. Keyed off completed_at, not state, so a mailbox that
  // failed AFTER its backfill also catches up rather than re-reading years.
  const catchUp = !opts.restart && !resuming && !!existing?.completed_at

  const sinceDays = resuming
    ? existing!.since_days
    : catchUp
      ? catchUpWindowDays(existing!.completed_at)
      : opts.sinceDays ?? null

  const maxPages = catchUp
    ? Math.min(opts.maxPages ?? CATCHUP_MAX_PAGES, CATCHUP_MAX_PAGES)
    : opts.maxPages ?? 5

  let pageToken: string | null = resuming ? existing!.page_token : null
  // Counters are cumulative across runs for a resumed or catching-up mailbox.
  let threadsSeen = resuming || catchUp ? existing!.threads_seen : 0
  let threadsNew = resuming || catchUp ? existing!.threads_new : 0
  // Per-run, deliberately not resumed from mailbox_sync: it reports what THIS
  // run brought up to date, which is what the caller and the health page want.
  let threadsRefreshed = 0
  let duplicatesSkipped = resuming || catchUp ? existing!.duplicates_skipped : 0

  await writeSync(mailbox, {
    state: 'running',
    since_days: sinceDays,
    last_error: null,
    // A catch-up pass keeps the backfill's started_at; completed_at is the
    // marker that moves, and the next window is measured from it.
    ...(resuming || catchUp ? {} : { started_at: new Date().toISOString(), completed_at: null }),
  })

  const known = await loadKnownThreads()
  let pagesThisRun = 0

  try {
    for (; pagesThisRun < maxPages; pagesThisRun++) {
      const page = await sweepPage(mailbox, {
        pageToken,
        sinceDays: sinceDays ?? undefined,
        pageSize: PAGE_SIZE,
        knownThreads: known,
        // Marketing is dropped at the Gmail edge on the lead side, so it never
        // costs a fetch or a model call.
        exclusions: pipeline === 'lead' ? leadExclusions() : undefined,
      })

      const { inserted, refreshed } = await persistThreads(
        page.threads,
        pipeline,
        page.grownFingerprints
      )
      threadsSeen += page.threads.length + page.duplicatesSkipped
      threadsNew += inserted
      threadsRefreshed += refreshed
      duplicatesSkipped += page.duplicatesSkipped
      notes.push(...page.notes)

      pageToken = page.nextPageToken

      // Checkpoint BEFORE deciding to continue — if the process dies on the
      // next page, this is where it resumes.
      await writeSync(mailbox, {
        page_token: pageToken,
        threads_seen: threadsSeen,
        threads_new: threadsNew,
        duplicates_skipped: duplicatesSkipped,
      })

      // Gmail lists newest-first, so on a catch-up pass the first page with
      // nothing new means everything below it is already stored. Stop there
      // rather than paging through the whole window every hour.
      //
      // A refreshed thread counts as "something new": a page carrying a reply to
      // an older conversation must not be read as the end of the window, or the
      // pass would stop short of replies further down it.
      const caughtUp = catchUp && inserted === 0 && refreshed === 0

      if (!pageToken || caughtUp) {
        await writeSync(mailbox, {
          state: 'complete',
          completed_at: new Date().toISOString(),
          // Drop the cursor so the next run starts a fresh window, not a
          // token that points into this run's now-stale result set.
          page_token: null,
        })
        return {
          mailbox,
          state: 'complete',
          pagesThisRun: pagesThisRun + 1,
          threadsSeen,
          threadsNew,
          threadsRefreshed,
          duplicatesSkipped,
          done: true,
          notes,
        }
      }
    }

    return {
      mailbox,
      state: 'running',
      pagesThisRun,
      threadsSeen,
      threadsNew,
      threadsRefreshed,
      duplicatesSkipped,
      done: false,
      notes,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sweep/fetch] ${mailbox} failed:`, message)
    await writeSync(mailbox, { state: 'failed', last_error: message.slice(0, 1000) })
    return {
      mailbox,
      state: 'failed',
      pagesThisRun,
      threadsSeen,
      threadsNew,
      threadsRefreshed,
      duplicatesSkipped,
      done: false,
      notes: [...notes, message],
    }
  }
}

/**
 * Advance the fetch phase across every configured mailbox.
 * Sequential on purpose: parallel mailboxes race on the shared fingerprint set
 * and would both insert the same cross-mailbox thread.
 */
export async function fetchAllMailboxes(
  opts: {
    maxPagesPerMailbox?: number
    sinceDays?: number | null
    restart?: boolean
    pipeline?: ThreadPipeline
  } = {}
): Promise<FetchProgress[]> {
  const pipeline = opts.pipeline ?? 'deal'
  const out: FetchProgress[] = []
  for (const mailbox of pipeline === 'lead' ? LEAD_MAILBOXES : MAILBOXES) {
    // Every mailbox is fetched every run. A finished backfill is not a finished
    // mailbox — fetchMailbox drops into a short catch-up window for those, so
    // mail that arrives after the backfill still reaches the CRM.
    out.push(
      await fetchMailbox(mailbox, {
        maxPages: opts.maxPagesPerMailbox,
        sinceDays: opts.sinceDays,
        restart: opts.restart,
        pipeline,
      })
    )
  }
  return out
}
