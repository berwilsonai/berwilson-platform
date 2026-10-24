/**
 * GET /api/cron/job-runner
 *
 * Takes the next queued job and runs it to completion. Driven by a launchd
 * agent every minute; a job also kicks this once when it is created, so the
 * normal wait is seconds rather than up to a minute.
 *
 * ⚠ WHY A CRON AND NOT THE ROUTE THAT CREATES THE JOB. Work fired off after a
 * route handler returns dies with the next kickstart, and `npm run build` IS
 * the deploy (§12). A job runs for minutes to an hour; shipping during one
 * would silently lose it. Driven from here, an interrupted job is reclaimed on
 * the heartbeat clock and the next tick picks it up.
 *
 * ⚠ ONE AT A TIME. `claimNextJob` refuses while another is live, because LM
 * Studio serves a single request at a time and a second job would only
 * interleave in the same queue (§12).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deferredResponse, interactiveRunInFlight } from '@/lib/ai/run-state'
import { claimNextJob, runClaimedJob } from '@/lib/jobs/queue'

// An hour: the job's own wall-clock budget brings it in to land before this.
export const maxDuration = 3600

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ⚠ A JOB STANDS ASIDE FOR A LIVE QUESTION, and of every pass here it is the
  // clearest case: a job is work somebody HANDED OVER, and /intel is somebody
  // sitting there waiting. LM Studio serves one request at a time, so starting
  // a 40-minute job now is added directly to their wait. Nothing is lost by
  // yielding — the next tick claims it, and a job already running is
  // checkpointed round by round. `?force=1` overrides.
  const waitingOnAnswer = await interactiveRunInFlight()
  if (waitingOnAnswer.busy && !request.nextUrl.searchParams.get('force')) {
    return NextResponse.json(deferredResponse('job-runner', waitingOnAnswer))
  }

  const db = createAdminClient()

  let job
  try {
    job = await claimNextJob(db)
  } catch (err) {
    // A failed READ of the queue must not read as an empty queue (§12).
    const message = err instanceof Error ? err.message : String(err)
    console.error('[job-runner] could not read the queue:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (!job) {
    return NextResponse.json({ claimed: null, note: 'nothing queued, or a job is already running' })
  }

  const outcome = await runClaimedJob(db, job)
  return NextResponse.json(outcome)
}
