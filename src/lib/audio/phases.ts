/**
 * Everything that happens to a recording's words once they are a thread.
 *
 * ⚠ ONE COPY, THREE DOORS. This sequence — route, apply, embed, extract
 * obligations, promote the internal ones, count what THESE threads produced —
 * lived twice, in `voicememos/sweep.ts` and `driveaudio/sweep.ts`, ~85%
 * identical with the differences all in note wording. §12 names that as the
 * hardest fork to see: two sibling modules written days apart, where neither
 * looks like a copy. The 10-19 upload door would have made it three, which is
 * the point at which a bug gets fixed in one place and not the other two — it
 * has already happened once in this family (`fileMeetingFromThreadLinks`).
 *
 * The per-source wording stays per-source, passed in, because it is genuinely
 * different advice: a voice memo is renamed on a phone, a Drive export is
 * dropped in a folder, and an upload was already filed by the person doing it.
 *
 * ⚠ TWO KINDS OF PHASE IN HERE, AND THE COUNTS COME FROM DIFFERENT PLACES.
 * `routeThreads` and `applyThreadUpdates` take named ids, so their own totals
 * are about these recordings. `embedPendingThreads`, `extractCommitments` and
 * `promoteInternalCommitments` work the QUEUE and take no id filter — which is
 * right (whatever else is pending is work the hourly sweep would do anyway) and
 * means their return values include other threads' work. So the obligation
 * counts are read back from the rows, by thread id. §12: never let a report
 * count work it did not do.
 */

import { applyThreadUpdates } from '@/lib/email-sweep/apply-phase'
import { embedPendingThreads } from '@/lib/ai/thread-embeddings'
import { extractCommitments } from '@/lib/commitments/extract-phase'
import { promoteInternalCommitments } from '@/lib/commitments/internal-tasks'
import { routeThreads, upsertLink } from '@/lib/email-sweep/route-phase'
import { sweepDb } from '@/lib/email-sweep/db'

export interface RecordingPhaseCounts {
  linked: number
  inferred: number
  updatesPosted: number
  updatesStaged: number
  meetingsFiled: number
  /** Obligations extracted from THESE threads, counted from the rows. */
  commitments: number
  /** Of those, the ones that became a task with no human confirm (§11). */
  tasksCreated: number
}

export interface RecordingPhaseResult {
  counts: RecordingPhaseCounts
  /** Anything a reader of the run log needs to know. Never silent on failure. */
  notes: string[]
}

export function emptyPhaseCounts(): RecordingPhaseCounts {
  return {
    linked: 0,
    inferred: 0,
    updatesPosted: 0,
    updatesStaged: 0,
    meetingsFiled: 0,
    commitments: 0,
    tasksCreated: 0,
  }
}

/** A record a human has already chosen, so the matcher is not consulted at all. */
export interface ThreadAssertion {
  threadId: string
  kind: 'project' | 'opportunity'
  recordId: string
  /** Why it is filed there, stored on the link and read by a person later. */
  reason: string
}

export interface RecordingPhaseInput {
  /** The threads to work. Only the ones that passed the work/noise gate. */
  threadIds: string[]
  /**
   * Links to write BEFORE routing, for records a human chose — a subfolder's
   * name, or the record an upload was made on.
   *
   * ⚠ WRITTEN AS `linked`, WHICH IS WHY IT MUST COME FIRST: `routeThreads`
   * respects an existing `linked` link and skips guessing for that thread
   * entirely. An assertion is not a better guess, it is not a guess.
   */
  assertions?: ThreadAssertion[]
  /**
   * What to say when nothing filed. Per-source because the remedy is
   * per-source. Omit it on a path where the record was asserted — there, an
   * unfiled thread is a fault rather than advice.
   */
  nothingFiledAdvice?: string
  /** Wall clock for the apply phase. Default 5 minutes. */
  applyBudgetMs?: number
}

/**
 * Run the shared phases over one batch of recording threads.
 *
 * Never throws: a recording's value is its transcript, which is already stored
 * by the time this runs. Each half reports its own failure and the hourly mail
 * sweep picks up whatever was left.
 */
export async function runRecordingPhases(
  input: RecordingPhaseInput
): Promise<RecordingPhaseResult> {
  const counts = emptyPhaseCounts()
  const notes: string[] = []
  const { threadIds, applyBudgetMs = 5 * 60 * 1000 } = input
  if (threadIds.length === 0) return { counts, notes }

  const db = sweepDb()

  // ── Assertions first, so routing has nothing to guess ─────────────────────
  for (const a of input.assertions ?? []) {
    if (!threadIds.includes(a.threadId)) continue
    try {
      await upsertLink(a.threadId, a.kind, a.recordId, 'linked', 1, a.reason)
    } catch (err) {
      notes.push(
        `⚠ Could not file the recording on the record a person chose: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // ── Route, then apply ─────────────────────────────────────────────────────
  try {
    const routed = await routeThreads({ threadIds })
    counts.linked = routed.linked
    counts.inferred = routed.inferred

    // ⚠ NAMED LINKS, SO THE REPORT IS ABOUT THESE RECORDINGS. With no ids
    // `applyThreadUpdates` drains the whole queue, and its counts would then
    // include every unapplied mail thread on the box — a sweep claiming it
    // posted eleven updates for one call. The links exist only now, because
    // `routeThreads` just wrote them.
    const { data: links } = await db.from('thread_links').select('id').in('thread_id', threadIds)
    const linkIds = (links ?? []).map((l) => (l as { id: string }).id)
    if (linkIds.length > 0) {
      const applied = await applyThreadUpdates({ linkIds, budgetMs: applyBudgetMs })
      counts.updatesPosted = applied.updatesPosted
      counts.updatesStaged = applied.updatesStaged
      counts.meetingsFiled = applied.recordingMeetingsFiled
    } else if (input.nothingFiledAdvice) {
      notes.push(input.nothingFiledAdvice)
    }
  } catch (err) {
    notes.push(
      `⚠ Routing or applying failed: ${err instanceof Error ? err.message : String(err)} — the ` +
        `transcripts are stored and the hourly mail sweep will pick them up.`
    )
  }

  // ── Index, obligations, and the internal ones that become tasks ───────────
  try {
    await embedPendingThreads({ budgetMs: 4 * 60 * 1000 })
    await extractCommitments({ budgetMs: 4 * 60 * 1000 })
    const internal = await promoteInternalCommitments()

    const { data: mine } = await db.from('commitments').select('id').in('thread_id', threadIds)
    const commitmentIds = (mine ?? []).map((c) => (c as { id: string }).id)
    counts.commitments = commitmentIds.length
    if (commitmentIds.length > 0) {
      const { count: tasks } = await db
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .in('commitment_id', commitmentIds)
      counts.tasksCreated = tasks ?? 0
    }

    if (internal.created > 0) {
      // The board publishes to a shared Google Sheet, and a follow-up from a
      // call that just ended has to reach the phone this hour.
      const { queueTaskSheetRefresh } = await import('@/lib/tasks/sheet-refresh')
      queueTaskSheetRefresh()
    }
  } catch (err) {
    notes.push(`⚠ Indexing or commitments failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  return { counts, notes }
}
