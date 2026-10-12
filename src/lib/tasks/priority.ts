/**
 * How important is this task? Derived, never typed.
 *
 * ⚠ THE PROBLEM THIS SOLVES IS NOT RANKING, IT IS WHAT WAS ON THE BOARD.
 * Measured 2026-10-12, before any of this: 11 of 22 open tasks were unsolicited
 * RFP bid deadlines, and the four tasks that sat on a real project belonged to
 * Alaska JV and Case Garage, whose newest correspondence was 2026-09-12 and
 * 2026-09-17. Every genuinely live deal — Steelton, Elite Solutions, Helper,
 * GridEdge, Myton Rail, IAN, all with mail through 10-09 or 10-10 — had not one
 * task between them. The board sorted strictly by due date, so the loudest row
 * was always whichever stranger's RFP closed soonest.
 *
 * So the tier answers Richard's own question — "is this around an active
 * conversation, or just a solicited email we haven't responded to" — and it is
 * DERIVED from correspondence rather than set by hand, for the reason §12 gives
 * about computed queues: a field somebody forgets to set reads as normal, and a
 * stored judgement goes stale silently while a derived one cannot.
 *
 * TWO ROUTES TO 'live', because a task reaches a live conversation two ways:
 *   - its RECORD is live: tagged to a project or opportunity that has had
 *     correspondence inside {@link LIVE_CORRESPONDENCE_DAYS};
 *   - its SOURCE is live: it was promoted from a commitment read out of a
 *     conversation that recent (`tasks.commitment_id`). Most such obligations
 *     carry no record at all — 277 of 367 open commitments name neither a
 *     project nor an opportunity — so a tag-only test would file every item off
 *     Eric's rundown as unattached, which is the opposite of the truth.
 *
 * ⚠ A TAG IS THE ONLY EVIDENCE; A TITLE IS NOT. "GridEdge offer" sits on the
 * board untagged while GridEdge the opportunity has 19 threads through 10-09 —
 * and it still reads as `unattached` here. Matching a record by a word in a
 * title is precisely what put Bloom Energy's logo on bfaenergy.com and claimed
 * a 664-message family thread for a hospital project (§12). The honest answer
 * is to show the tier the tags support and let a human tag the task.
 */

import { createUntypedAdminClient } from '@/lib/supabase/admin'

/**
 * How recently a conversation must have moved to count as live.
 *
 * ONE NUMBER, ONE DEFINITION (§12). The same window decides which tasks rank
 * 'live' here and which internal obligations are promoted onto the board at all
 * (`commitments/internal-tasks.ts`), so the board cannot disagree with itself
 * about what "active" means. Measured against the corpus: at 14 days the live
 * set is the six deals actually in play, where 30 days pulls in Zenthium and
 * Stockton, which are not being worked this fortnight.
 */
export const LIVE_CORRESPONDENCE_DAYS = 14

export type TaskTier = 'live' | 'tagged' | 'unattached'

/** Everything the tier is read from. All of it optional; absence is a tier. */
export interface TierInput {
  project_id?: string | null
  opportunity_id?: string | null
  investor_id?: string | null
  objective_id?: string | null
  commitment_id?: string | null
}

/**
 * The records and commitments whose conversations have moved lately.
 *
 * Passed in rather than fetched so this stays pure and the board computes every
 * row's tier without a query per task. Built by {@link loadLiveContext}.
 */
export interface LiveContext {
  /** `projects.id` and `opportunities.id` with correspondence inside the window. */
  liveRecordIds: Set<string>
  /** `commitments.id` whose source thread is inside the window. */
  liveCommitmentIds: Set<string>
}

export const EMPTY_LIVE_CONTEXT: LiveContext = {
  liveRecordIds: new Set(),
  liveCommitmentIds: new Set(),
}

export function taskTier(task: TierInput, live: LiveContext): TaskTier {
  const recordId = task.project_id ?? task.opportunity_id ?? null
  if (recordId && live.liveRecordIds.has(recordId)) return 'live'
  if (task.commitment_id && live.liveCommitmentIds.has(task.commitment_id)) return 'live'

  // Anything hung off a record of any kind is at least attached work. An
  // objective counts: it is the steering board, which is a deliberate statement
  // that the work matters even when no mail has moved.
  if (
    task.project_id ||
    task.opportunity_id ||
    task.investor_id ||
    task.objective_id ||
    task.commitment_id
  ) {
    return 'tagged'
  }
  return 'unattached'
}

const TIER_RANK: Record<TaskTier, number> = { live: 0, tagged: 1, unattached: 2 }

export function tierRank(tier: TaskTier): number {
  return TIER_RANK[tier]
}

export const TIER_LABELS: Record<TaskTier, string> = {
  live: 'Live deal',
  tagged: 'Attached',
  unattached: 'Unattached',
}

/**
 * What a tier looks like on a row.
 *
 * ⚠ ONE COLOUR CARRIES MEANING AND THE OTHER TWO RECEDE. §12: when every row is
 * red, red has stopped signifying — nine consecutive commitments at 227d, 218d
 * and 117d all in alarm colour is what taught that. So 'live' is the only tier
 * that is coloured at all; 'tagged' is the ordinary border and 'unattached' is
 * dimmer than ordinary. Overdue keeps the red edge on top of this, because
 * being late is a different fact from being important.
 *
 * Full literal class strings — Tailwind v4 emits only what it finds by scanning
 * source, so an interpolated class produces an unstyled element with no error
 * anywhere (§12).
 */
export const TIER_BORDER: Record<TaskTier, string> = {
  live: 'border-l-[3px] border-l-emerald-500 dark:border-l-emerald-400',
  tagged: '',
  unattached: '',
}

export const TIER_CHIP: Record<TaskTier, string> = {
  live: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  tagged: '',
  unattached: '',
}

/**
 * Read which records and commitments are live right now.
 *
 * TWO READS, BOTH OVER `thread_links` → `email_threads.last_at`, which is the
 * only place the platform records "this conversation moved". Deliberately NOT
 * `updates.created_at`: an update is written when the apply phase posts text
 * onto a record, which lags the conversation and stops entirely once a thread's
 * `applied_message_count` has caught up — so a busy deal can look silent.
 *
 * ⚠ PAGED. PostgREST truncates at 1000 rows silently (§12), and `thread_links`
 * is already past that: 525 lead links alone, plus every deal thread. A short
 * read here would quietly demote real live work to 'tagged', which is the kind
 * of wrong that looks like a design decision.
 *
 * ⚠ AND AN ERROR IS REPORTED, NOT SWALLOWED. §12: an exclusion that fails
 * silently reads as "there is nothing on file" — here it would read as "nothing
 * is live", greying the whole board with no explanation. The caller is handed
 * the reason so the screen can say the ranking is unavailable rather than
 * asserting that nothing matters.
 */
export async function loadLiveContext(
  now: Date = new Date()
): Promise<LiveContext & { error: string | null }> {
  const since = new Date(now.getTime() - LIVE_CORRESPONDENCE_DAYS * 86_400_000).toISOString()
  const db = createUntypedAdminClient()

  const liveRecordIds = new Set<string>()

  const PAGE = 1000
  for (let page = 0; ; page++) {
    const { data, error } = await db
      .from('thread_links')
      .select('record_kind, record_id, thread:email_threads!inner(id, last_at)')
      .gte('thread.last_at', since)
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) {
      return { liveRecordIds, liveCommitmentIds: new Set(), error: error.message }
    }

    const rows = (data ?? []) as {
      record_kind: string
      record_id: string
      thread: { id: string; last_at: string | null } | { id: string; last_at: string | null }[] | null
    }[]

    for (const row of rows) {
      const thread = Array.isArray(row.thread) ? row.thread[0] : row.thread
      if (!thread?.last_at || thread.last_at < since) continue
      // Only the two record kinds a task can be tagged to. A lead link is the
      // noisiest kind by far and no task hangs off one any more.
      if (row.record_kind === 'project' || row.record_kind === 'opportunity') {
        liveRecordIds.add(row.record_id)
      }
    }

    if (rows.length < PAGE) break
  }

  /**
   * A commitment's own thread — the route most promoted tasks reach 'live' by,
   * since 277 of 367 open commitments name neither a project nor an
   * opportunity.
   *
   * ⚠ READ STRAIGHT OFF `email_threads`, NOT THROUGH `thread_links`, AND THE
   * FIRST VERSION GOT THIS WRONG IN THE WAY THAT IS HARDEST TO SEE. It reused
   * the thread ids gathered above, which only exist for a thread FILED against
   * a record — and an internal text session between the two executives usually
   * is not filed against anything. So 9 of the 34 obligations promoted on
   * 2026-10-12 were ranked `tagged` while the pass that promoted them had
   * called the very same conversation live, because the two reads reached
   * recency by different paths. §12: one quantity, one definition — and the
   * definition has to be the same READ, not just the same number of days.
   * `internal-tasks.ts` filters on `email_threads.last_at`, so this must too.
   */
  const liveCommitmentIds = new Set<string>()
  for (let page = 0; ; page++) {
    const { data, error } = await db
      .from('commitments')
      .select('id, thread:email_threads!inner(last_at)')
      .gte('thread.last_at', since)
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) {
      return { liveRecordIds, liveCommitmentIds, error: error.message }
    }
    const rows = (data ?? []) as { id: string }[]
    for (const row of rows) liveCommitmentIds.add(row.id)
    if (rows.length < PAGE) break
  }

  return { liveRecordIds, liveCommitmentIds, error: null }
}
