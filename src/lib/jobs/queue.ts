/**
 * Claiming and settling a job.
 *
 * ⚠ ONE JOB AT A TIME, AND THAT IS NOT A LIMITATION TO FIX. LM Studio serves a
 * single request at a time (§12), so two jobs running concurrently would not be
 * twice as fast — they would interleave in the same queue, and a latency
 * measured during one would be measuring the other. Worse, the eight
 * model-heavy sweeps and /intel share the same server, so a job must be a
 * citizen rather than a hog.
 *
 * ⚠ THE CLAIM IS A CONDITIONAL UPDATE, NOT A READ-THEN-WRITE. `update … where
 * id = ? and status = 'queued'` returning nothing means somebody else took it.
 * Reading first and writing second is the double-run.
 *
 * ⚠ AND `working` IS THE STATUS THAT CANNOT SETTLE ITSELF. A kickstart kills the
 * runner before it can record either verdict, so a stale `working` row is
 * reclaimed on the heartbeat clock rather than latched forever (§12 — an
 * in-progress status must always be paired with a started-at).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { JsonIn } from '@/lib/supabase/types'
import { jobStaleMs, runJob } from './run'

export interface JobQueueRow {
  id: string
  instruction: string
  created_by: string
  title: string | null
}

const CLAIM_COLUMNS = 'id, instruction, created_by, title'

/**
 * Take the oldest queued job, or reclaim one abandoned by a deploy.
 * Returns null when there is nothing to do — the normal case.
 */
export async function claimNextJob(
  db: SupabaseClient<Database>
): Promise<JobQueueRow | null> {
  // ⚠ Refuse to start a second one. A `working` row inside its heartbeat window
  // is a live job; outside it, it was killed and is reclaimable below.
  const horizon = new Date(Date.now() - jobStaleMs()).toISOString()
  const { data: live, error: liveErr } = await db
    .from('jobs')
    .select('id')
    .eq('status', 'working')
    .gt('heartbeat_at', horizon)
    .limit(1)
  // §12: check the error on every select — a zero from a broken query and a
  // zero from an empty table are the same value and opposite facts.
  if (liveErr) throw new Error(`could not read running jobs: ${liveErr.message}`)
  if (live && live.length > 0) return null

  // Abandoned first: a job somebody is waiting on beats a job nobody has started.
  const { data: stale, error: staleErr } = await db
    .from('jobs')
    .select(CLAIM_COLUMNS)
    .eq('status', 'working')
    .or(`heartbeat_at.is.null,heartbeat_at.lte.${horizon}`)
    .order('queued_at')
    .limit(1)
  if (staleErr) throw new Error(`could not read stale jobs: ${staleErr.message}`)

  if (stale && stale.length > 0) {
    const row = stale[0]
    const { data: taken } = await db
      .from('jobs')
      .update({ heartbeat_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'working')
      .select(CLAIM_COLUMNS)
      .maybeSingle()
    if (taken) return taken
  }

  const { data: queued, error: queuedErr } = await db
    .from('jobs')
    .select('id')
    .eq('status', 'queued')
    .order('queued_at')
    .limit(1)
  if (queuedErr) throw new Error(`could not read the job queue: ${queuedErr.message}`)
  if (!queued || queued.length === 0) return null

  const now = new Date().toISOString()
  const { data: claimed } = await db
    .from('jobs')
    .update({ status: 'working', started_at: now, heartbeat_at: now })
    .eq('id', queued[0].id)
    .eq('status', 'queued')
    .select(CLAIM_COLUMNS)
    .maybeSingle()

  // Null means another runner took it between the read and the update, which is
  // exactly what the conditional update is for. Not an error.
  return claimed ?? null
}

export interface RunOutcome {
  jobId: string
  status: 'review' | 'done' | 'failed'
  operations: number
  rounds: number
  error?: string
}

/**
 * Run a claimed job to completion and settle it.
 *
 * A job that proposed changes lands in `review` — it is NOT done, because the
 * work it asked for has not happened yet. One that proposed nothing is `done`:
 * its report IS the deliverable, and sending a reader to a review screen with
 * nothing on it would be the §12 "surface hidden because it is empty" bug
 * inverted.
 */
export async function runClaimedJob(
  db: SupabaseClient<Database>,
  job: JobQueueRow
): Promise<RunOutcome> {
  try {
    const result = await runJob({
      db,
      jobId: job.id,
      instruction: job.instruction,
      userId: job.created_by,
    })

    const status = result.operations.length > 0 ? 'review' : 'done'
    await db
      .from('jobs')
      .update({
        status,
        report: result.report,
        operations: result.operations as unknown as JsonIn,
        rounds: result.rounds,
        model: result.model,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        latency_ms: result.latencyMs,
        heartbeat_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    await db.from('job_events').insert({
      job_id: job.id,
      seq: 9_999_999,
      kind: 'status',
      label: status,
      detail: {
        rounds: result.rounds,
        operations: result.operations.length,
        hit_budget: result.hitBudget,
        latency_ms: result.latencyMs,
      } as unknown as JsonIn,
    })

    return { jobId: job.id, status, operations: result.operations.length, rounds: result.rounds }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // ⚠ A failure must SETTLE the row. Leaving it `working` makes it immortal
    // until the heartbeat expires, and the reader cannot tell a crash from a
    // long job.
    await db
      .from('jobs')
      .update({
        status: 'failed',
        error: message.slice(0, 4000),
        finished_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
      })
      .eq('id', job.id)
    console.error(`[job ${job.id.slice(0, 8)}] failed:`, message)
    return { jobId: job.id, status: 'failed', operations: 0, rounds: 0, error: message }
  }
}
