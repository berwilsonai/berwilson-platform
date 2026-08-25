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
 * because fingerprints already stored are skipped on insert.
 */

import { sweepPage, renderThread, leadExclusions, type ResolvedThread } from '@/lib/integrations/gmail-search'
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
  duplicatesSkipped: number
  done: boolean
  notes: string[]
}

/** Load every fingerprint already stored, so cross-mailbox copies are skipped. */
async function loadKnownFingerprints(): Promise<Set<string>> {
  const db = sweepDb()
  const known = new Set<string>()

  // Paged — a full backfill can exceed PostgREST's default row ceiling.
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('email_threads')
      .select('fingerprint')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Could not load known threads: ${error.message}`)
    for (const row of data ?? []) known.add((row as { fingerprint: string }).fingerprint)
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

async function persistThreads(
  threads: ResolvedThread[],
  pipeline: ThreadPipeline
): Promise<number> {
  if (threads.length === 0) return 0
  const db = sweepDb()

  const rows = threads.map((t) => ({
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
  }))

  // ignoreDuplicates: a thread already captured from the other mailbox (or a
  // previous run) must NOT have its summary reset to pending.
  const { data, error } = await db
    .from('email_threads')
    .upsert(rows, { onConflict: 'fingerprint', ignoreDuplicates: true })
    .select('id')

  if (error) throw new Error(`Could not store threads: ${error.message}`)
  return data?.length ?? 0
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
  let duplicatesSkipped = resuming || catchUp ? existing!.duplicates_skipped : 0

  await writeSync(mailbox, {
    state: 'running',
    since_days: sinceDays,
    last_error: null,
    // A catch-up pass keeps the backfill's started_at; completed_at is the
    // marker that moves, and the next window is measured from it.
    ...(resuming || catchUp ? {} : { started_at: new Date().toISOString(), completed_at: null }),
  })

  const known = await loadKnownFingerprints()
  let pagesThisRun = 0

  try {
    for (; pagesThisRun < maxPages; pagesThisRun++) {
      const page = await sweepPage(mailbox, {
        pageToken,
        sinceDays: sinceDays ?? undefined,
        pageSize: PAGE_SIZE,
        knownFingerprints: known,
        // Marketing is dropped at the Gmail edge on the lead side, so it never
        // costs a fetch or a model call.
        exclusions: pipeline === 'lead' ? leadExclusions() : undefined,
      })

      const inserted = await persistThreads(page.threads, pipeline)
      threadsSeen += page.threads.length + page.duplicatesSkipped
      threadsNew += inserted
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
      const caughtUp = catchUp && inserted === 0

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
