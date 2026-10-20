/**
 * Retire obligations whose conversation died.
 *
 * ⚠ THE LEDGER COULD ONLY EVER GROW, AND THIS IS THE HALF THAT WAS MISSING.
 * A commitment is re-judged exactly once: when its thread grows. The sweep
 * clears `commitments_at` on a refreshed thread (`email-sweep/fetch-phase.ts`),
 * the extractor re-reads it, and any open row the new extraction no longer
 * claims is auto-`resolved` (`extract-phase.ts`). That machinery is right, and
 * it is why the live half of the ledger stays honest.
 *
 * But a thread that goes QUIET is never re-read, because nothing ever clears
 * the marker again. Measured 2026-10-15: of 527 open obligations, 294 sit on
 * threads with no message in 14 days and 82 on threads silent for 90+; 246 of
 * the 294 carry no due date, so nothing ages them out by deadline either. They
 * are immortal. Against that, 14 had ever been settled by a human — the loop
 * was not being worked because the number never went down, and a number that
 * only goes up stops being read (§13 recorded exactly this of Pepper's note).
 *
 * ⚠ IT MAKES NO MODEL CALL, DELIBERATELY. The judgement here is not "was this
 * done" — nobody can know that from silence. It is "this conversation is over,
 * so an obligation extracted from it is no longer worth putting in front of
 * somebody every morning". That is a fact about dates, and §12's rule is to
 * print the figure rather than ask the model to infer it.
 *
 * ⚠ AND IT IS `resolved`, NOT `done`. `CommitmentStatus` already separates the
 * machine's verdict from a person's (see ./db): `resolved` is the state the
 * extractor uses and may be rewritten on any later sweep, while `done` and
 * `dismissed` are decisions that must never be overwritten. So this reuses the
 * machine state and the consequences fall out for free — the row leaves every
 * reader (they all filter `status='open'`), the human-progress counts do not
 * move (they filter HUMAN_SETTLED), and if the conversation ever revives, the
 * re-extraction puts the obligation back. The reason travels in `settled_by`,
 * which is where the 10-09 self-loop repair put its own reason for the same
 * purpose: these rows have no audit trigger, so the column IS the record.
 */

import { sweepDb } from '@/lib/email-sweep/db'
import { readOpenCommitments } from './read'
import type { CommitmentRow } from './db'

/**
 * How long a conversation must have been silent.
 *
 * ⚠ MEASURED, NOT CHOSEN (§12), and the distribution is in the header above.
 * 45 days is two full chase cycles past the undated chase bar of 21 — so every
 * row this closes has already had its follow-up composed and three more weeks
 * of silence after it. Shorter than that and it starts closing conversations
 * that are merely slow; the 14-day band holds 99 rows and a fortnight is an
 * ordinary gap in a land deal.
 *
 * Verify before changing it: `npx tsx scripts/one-shot/dry-aging.mts`.
 *
 * ⚠ 45 → 21 ON 2026-10-19, measured, on Richard's call: the ledger was
 * "overwhelming to sift through". At 45 the pass had done its job and the
 * ledger still stood at 244 open across only 125 conversations, with 203 of
 * those rows on threads already silent a week or more. Re-swept over the live
 * corpus: 30d retires 35 (leaving 209, barely moving it), 21d retires 76
 * (leaving 168), 14d retires 123 — and 14 is the one the paragraph above still
 * rules out, because a fortnight is an ordinary gap in a land deal and that
 * has not changed. 21 keeps the original argument intact: it is still two full
 * chase cycles past the undated chase bar, so every row this closes has had a
 * follow-up composed and a further week of silence after it.
 */
export const STALE_THREAD_DAYS = 21

/**
 * Extra grace for a row that was chased.
 *
 * A chase is a promise to wait a bit longer. Closing something the morning
 * after Pepper asked about it would make the chase a lie, so a chased row needs
 * the thread to have stayed silent this long AFTER the chase was composed.
 */
export const CHASE_GRACE_DAYS = 14

/** How many thread ids go in one `.in()`. §12: 1000 uuids is a 37KB URL Kong refuses. */
const ID_CHUNK = 200

/** The ceiling on one read. Reported when hit, never silently truncating. */
const READ_LIMIT = 1000

export interface AgingCandidate {
  id: string
  what: string
  side: 'us' | 'them'
  dueDate: string | null
  /** The thread's newest message, which is what makes it stale. */
  threadLastAt: string | null
  silentDays: number
  wasChased: boolean
}

export interface AgingProgress {
  /** Open rows examined after the confidentiality filter. */
  considered: number
  /** Rows whose conversation is stale enough to retire. */
  eligible: number
  retired: number
  /** Still open because a human quieted them — a decision, not neglect. */
  skippedSnoozed: number
  /** Still open because a human put them back. Never closed automatically again. */
  skippedReopened: number
  /** Chased recently enough that closing them would make the chase a lie. */
  skippedChaseGrace: number
  /** No thread row to date, so staleness is unknowable. Never retired. */
  skippedUndatable: number
  /**
   * Still open because the obligation's own due date has not arrived.
   *
   * Counted separately rather than folded into the others because it is the
   * one keep-reason that says the row is LIVE — §12: count the reason beside
   * the number, an unlabelled count is not a coverage signal.
   */
  skippedFutureDue: number
  /** True when the read hit its ceiling and there may be more. */
  truncated: boolean
  failed: number
  errors: string[]
  /** A few of each outcome, for a dry run to print. */
  samples: AgingCandidate[]
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!isFinite(then)) return null
  return Math.floor((Date.now() - then) / 86_400_000)
}

/** The thread's newest message, for every thread these rows sit on. */
async function threadActivity(threadIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const db = sweepDb()
  for (let i = 0; i < threadIds.length; i += ID_CHUNK) {
    const chunk = threadIds.slice(i, i + ID_CHUNK)
    const { data, error } = await db.from('email_threads').select('id, last_at').in('id', chunk)
    // ⚠ A FAILED READ IS NOT "NO ACTIVITY". §12: never read a failed record
    // read as "no records exist" — here that would date every thread to never
    // and retire the whole ledger in one pass. Throwing is the safe answer.
    if (error) throw new Error(`could not read thread activity: ${error.message}`)
    for (const row of (data ?? []) as { id: string; last_at: string | null }[]) {
      out.set(row.id, row.last_at)
    }
  }
  return out
}

/**
 * Is this row's conversation over?
 *
 * Pure, so the dry run and the live pass cannot disagree about what is
 * eligible — and so the threshold can be swept without touching the database.
 */
export function agingVerdict(
  row: Pick<
    CommitmentRow,
    'snoozed_until' | 'chase_composed_at' | 'chase_text' | 'reopened_at' | 'due_date'
  >,
  threadLastAt: string | null,
  staleDays: number,
  today = new Date().toISOString().slice(0, 10)
): { action: 'retire' | 'keep'; reason: string } {
  // A human putting this back is a decision, and a permanent one as far as this
  // pass is concerned. ⚠ WITHOUT THIS THE UNDO WORKED EXACTLY ONCE: reopening
  // restores the row to the precise state this pass selects, so it was closed
  // again the next morning and every morning after. They can still settle,
  // dismiss or quiet it — what they get is immunity from the AUTOMATIC close.
  if (row.reopened_at) {
    return { action: 'keep', reason: 'reopened by a human' }
  }

  // ⚠ A DATE STILL AHEAD IS THE OBLIGATION SAYING IT IS LIVE, WHATEVER THE
  // THREAD DID. This pass reads silence as "the conversation is over", which is
  // a fair inference for the 87% of rows carrying no date at all — but a
  // counterparty who said "by the 30th" and then went quiet is exactly on
  // schedule, and retiring them deletes the one row that would have chased it.
  // Latent at 45 days (0 of 158 retired rows had a future date) and live at 21,
  // where one does: §12's rule that a threshold change can break a filter it
  // never touched.
  if (row.due_date && row.due_date >= today) {
    return { action: 'keep', reason: `due ${row.due_date}, which has not passed` }
  }

  // A human saying "ask me next week" is a decision. The row stays open and
  // counted — that is what a snooze IS (see the migration on snoozed_until).
  if (row.snoozed_until && row.snoozed_until > today) {
    return { action: 'keep', reason: 'snoozed' }
  }

  const silent = daysSince(threadLastAt)
  if (silent === null) {
    return { action: 'keep', reason: 'no thread activity on file, so staleness is unknowable' }
  }
  if (silent < staleDays) {
    return { action: 'keep', reason: `conversation moved ${silent} days ago` }
  }

  // A chase is a promise to wait. `chase_composed_at` is the clock added
  // 2026-10-15; `chase_text` with no timestamp is a pre-backfill row, which the
  // migration dated from `updated_at`, so an absent timestamp with text present
  // means something went wrong and the safe read is "chased just now".
  if (row.chase_text) {
    const sinceChase = daysSince(row.chase_composed_at)
    if (sinceChase === null) {
      return { action: 'keep', reason: 'chased, with no composed-at to measure the grace from' }
    }
    if (sinceChase < CHASE_GRACE_DAYS) {
      return { action: 'keep', reason: `chased ${sinceChase} days ago` }
    }
  }

  return { action: 'retire', reason: `conversation silent ${silent} days` }
}

/**
 * Walk the open ledger and retire what the conversation has moved past.
 *
 * `staleDays` is a parameter rather than a constant read inside so the dry run
 * can sweep several thresholds over the same corpus in one go — §12: a
 * threshold is measured against the real data, and two identically shaped rows
 * fall either side of any number you pick.
 */
export async function runAgingPass(
  opts: { dryRun?: boolean; staleDays?: number; limit?: number } = {}
): Promise<AgingProgress> {
  const { dryRun = false, staleDays = STALE_THREAD_DAYS, limit = READ_LIMIT } = opts
  const progress: AgingProgress = {
    considered: 0,
    eligible: 0,
    retired: 0,
    skippedSnoozed: 0,
    skippedReopened: 0,
    skippedChaseGrace: 0,
    skippedUndatable: 0,
    skippedFutureDue: 0,
    truncated: false,
    failed: 0,
    errors: [],
    samples: [],
  }

  // Through the choke point, which also means a confidential project's
  // obligations are not touched here at all. That follows the curator's
  // precedent (`curator/run.ts`): a change nobody can be told about is worse
  // than no change, and this pass's whole point is that the morning note
  // reports what it did.
  const { rows, error } = await readOpenCommitments({ limit })
  if (error) {
    progress.failed = 1
    progress.errors.push(error)
    return progress
  }

  progress.considered = rows.length
  progress.truncated = rows.length >= limit

  const threadIds = [...new Set(rows.map((r) => r.thread_id).filter((v): v is string => !!v))]
  let activity: Map<string, string | null>
  try {
    activity = await threadActivity(threadIds)
  } catch (err) {
    progress.failed = 1
    progress.errors.push(err instanceof Error ? err.message : String(err))
    return progress
  }

  const retire: { row: CommitmentRow; lastAt: string | null; silent: number }[] = []

  for (const row of rows) {
    const lastAt = row.thread_id ? (activity.get(row.thread_id) ?? null) : null
    const verdict = agingVerdict(row, lastAt, staleDays)

    if (verdict.action === 'keep') {
      if (verdict.reason === 'reopened by a human') progress.skippedReopened++
      else if (verdict.reason === 'snoozed') progress.skippedSnoozed++
      else if (verdict.reason.startsWith('chased')) progress.skippedChaseGrace++
      else if (verdict.reason.startsWith('no thread activity')) progress.skippedUndatable++
      else if (verdict.reason.startsWith('due ')) progress.skippedFutureDue++
      continue
    }

    const silent = daysSince(lastAt) ?? 0
    retire.push({ row, lastAt, silent })
  }

  progress.eligible = retire.length

  // Newest-silent first, so a dry run's samples show the boundary cases rather
  // than only the ancient ones everybody already agrees about.
  progress.samples = retire
    .slice()
    .sort((a, b) => a.silent - b.silent)
    .slice(0, 20)
    .map(({ row, lastAt, silent }) => ({
      id: row.id,
      what: row.what,
      side: row.side,
      dueDate: row.due_date,
      threadLastAt: lastAt,
      silentDays: silent,
      wasChased: !!row.chase_text,
    }))

  if (dryRun) return progress

  const db = sweepDb()
  for (const { row, lastAt } of retire) {
    const since = (lastAt ?? '').slice(0, 10) || 'an unknown date'
    const { error: writeError } = await db
      .from('commitments')
      .update({
        status: 'resolved',
        settled_at: new Date().toISOString(),
        // The reason, in the column the self-loop repair used for its own.
        // There is no audit trigger on this table, so this IS the record of why
        // — and it is what makes the morning line and the undo legible.
        settled_by: `aged out — conversation silent since ${since}`,
        snoozed_until: null,
      })
      .eq('id', row.id)
      // Selected back so a miss is a miss, not a 200 that did nothing.
      .select('id')
      .maybeSingle()

    if (writeError) {
      progress.failed++
      if (progress.errors.length < 5) {
        progress.errors.push(`${row.id}: could not retire — ${writeError.message}`)
      }
      continue
    }
    progress.retired++
  }

  return progress
}

/**
 * How many obligations the pass retired since a moment — for the morning note.
 *
 * ⚠ READ OFF THE ROWS, NOT CARRIED FROM THE RUN. The note runs hours after the
 * pass and in a different process; §12's rule that a pass reporting what it did
 * must read before it writes has a sibling here, which is that a reporter must
 * read what happened rather than be told.
 */
export async function countRetiredSince(sinceIso: string): Promise<number> {
  const { count, error } = await sweepDb()
    .from('commitments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'resolved')
    .like('settled_by', 'aged out —%')
    .gte('settled_at', sinceIso)
  if (error) return 0
  return count ?? 0
}
