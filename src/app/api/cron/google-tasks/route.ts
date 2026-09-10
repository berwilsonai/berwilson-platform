import { NextRequest, NextResponse } from 'next/server'
import { syncGoogleTasks } from '@/lib/tasks/google-sync'
import { isGoogleConfigured, TASK_MAILBOXES } from '@/lib/integrations/google-workspace'

/**
 * GET /api/cron/google-tasks
 *
 * Reconciles the task board against each connected member's Google Tasks list,
 * both directions. Every 15 minutes, via com.berwilson.cron-google-tasks.
 *
 * The cadence is minutes rather than nightly on purpose: three confirm routes
 * create tasks in bulk without touching /api/tasks, so they never fire the
 * immediate push, and "the tasks someone just assigned you appear tomorrow" is
 * the wrong answer for a to-do list.
 *
 * Unconfigured is not an error. Most of the team has not connected an account
 * and that is the expected steady state, so a 503 in the log four times an hour
 * would be pure noise — /settings/health reports the coverage instead.
 *
 * `dryRun=1` does everything except write, on either side, and still fills in
 * every counter. It is the safe way to point the real reconcile at real
 * accounts and read exactly what it would do first.
 */
export const maxDuration = 900

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isGoogleConfigured()) {
    return NextResponse.json({
      skipped: true,
      reason: 'Google Workspace is not configured.',
    })
  }

  if (TASK_MAILBOXES.length === 0) {
    return NextResponse.json({
      skipped: true,
      reason: 'GOOGLE_TASK_MAILBOXES is unset, so no member has a task list to sync.',
    })
  }

  const params = request.nextUrl.searchParams
  const budgetMs = Number(params.get('budgetMs')) || 10 * 60 * 1000
  const dryRun = params.get('dryRun') === '1' || params.get('dryRun') === 'true'
  const onlyMemberId = params.get('member') ?? undefined

  try {
    const result = await syncGoogleTasks({ budgetMs, dryRun, onlyMemberId })
    console.log('[cron/google-tasks]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/google-tasks] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
