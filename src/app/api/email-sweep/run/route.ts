import { NextRequest } from 'next/server'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { runSweep, type SweepPhase } from '@/lib/email-sweep/orchestrator'
import { retryFailedSummaries } from '@/lib/email-sweep/summarize-phase'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'

/**
 * POST /api/email-sweep/run
 *
 * Manual "run now" for the mailbox sweep — the same orchestrator the hourly
 * cron drives, so behaviour is identical. Used to kick off the very first
 * backfill and to push the sweep along without waiting for the next tick.
 *
 * Body (all optional):
 *   phases      SweepPhase[]   which phases to advance (default: all)
 *   budgetMs    number         wall-clock budget (default 5 min, capped 55 min)
 *   sinceDays   number|null    history window for a FRESH fetch; null = all
 *   restart     boolean        discard the saved cursor and refetch from page 1
 *   retryFailed boolean        requeue previously failed summaries first
 */
export const maxDuration = 3600

const VALID_PHASES: SweepPhase[] = ['fetch', 'summarize', 'cluster', 'stage']

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson('Admins only')

  if (!isGoogleConfigured()) {
    return Response.json(
      { error: 'Google Workspace is not configured — see deploy/google-workspace-setup.md.' },
      { status: 503 }
    )
  }

  const body = await request.json().catch(() => ({}))

  const phases = Array.isArray(body.phases)
    ? (body.phases as unknown[]).filter((p): p is SweepPhase =>
        VALID_PHASES.includes(p as SweepPhase)
      )
    : undefined

  // Default short so the browser gets an answer; the cron does the long hauls.
  const budgetMs = Math.min(
    Number(body.budgetMs) > 0 ? Number(body.budgetMs) : 5 * 60 * 1000,
    55 * 60 * 1000
  )

  const sinceDays =
    body.sinceDays === null ? null : Number(body.sinceDays) > 0 ? Number(body.sinceDays) : undefined

  try {
    let requeued = 0
    if (body.retryFailed === true) requeued = await retryFailedSummaries()

    const result = await runSweep({
      phases: phases?.length ? phases : undefined,
      budgetMs,
      sinceDays,
      restart: body.restart === true,
      userId: viewer.authUserId,
    })

    return Response.json({ ...result, requeued })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[email-sweep/run] failed:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
