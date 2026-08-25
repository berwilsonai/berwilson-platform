import { NextRequest, NextResponse } from 'next/server'
import { runSweep } from '@/lib/email-sweep/orchestrator'
import { isGoogleConfigured, MAILBOXES } from '@/lib/integrations/google-workspace'
import { recordSweepUnavailable } from '@/lib/email-sweep/db'

/**
 * GET /api/cron/email-sweep
 *
 * The mailbox sweep's heartbeat. Driven by com.berwilson.cron-email-sweep on
 * the Studio, hourly. Each tick advances the sweep by one time-boxed slice and
 * exits; the sweep's state lives in the database, so progress is cumulative
 * across ticks and survives reboots and deploys.
 *
 * A full first backfill of both mailboxes takes many ticks — that is expected
 * and by design. The queue drains newest-first, so the live pipeline reaches
 * the CRM long before the archive does.
 */
export const maxDuration = 3600

export async function GET(request: NextRequest) {
  // Verify cron secret (fail closed if the secret is not configured)
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isGoogleConfigured()) {
    const reason = 'Google Workspace is not configured — see deploy/google-workspace-setup.md.'
    // Flag the outage so the dashboard's mailbox alert fires. Bailing silently
    // here is how mail stops reaching the CRM with every screen still green.
    await recordSweepUnavailable(MAILBOXES, reason)
    return NextResponse.json({ error: reason }, { status: 503 })
  }

  // Stay under the curl timeout the launchd job uses, with room for the
  // in-flight thread to finish after the budget expires.
  const budgetMs = Number(request.nextUrl.searchParams.get('budgetMs')) || 50 * 60 * 1000

  try {
    const result = await runSweep({ budgetMs })
    console.log('[cron/email-sweep]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/email-sweep] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
