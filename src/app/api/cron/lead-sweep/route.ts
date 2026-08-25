import { NextRequest, NextResponse } from 'next/server'
import { runLeadSweep } from '@/lib/leads/orchestrator'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'

/**
 * GET /api/cron/lead-sweep
 *
 * Reads info@, triages what arrived, scores what survives. Driven by
 * com.berwilson.cron-lead-sweep on the Studio, daily.
 *
 * Deliberately separate from the hourly deal sweep rather than another phase
 * inside it: the two must not compete for the same clock (a long deal backfill
 * would starve lead triage indefinitely), and a fault in one must not stall the
 * other.
 */
export const maxDuration = 3600

export async function GET(request: NextRequest) {
  // Fail closed when the secret is not configured — an unset secret must never
  // leave a public route open (CLAUDE.md 2026-07-03).
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: 'Google Workspace is not configured — see deploy/google-workspace-setup.md.' },
      { status: 503 }
    )
  }

  // Stay under the curl timeout the launchd job uses, with room for the
  // in-flight thread to finish after the budget expires.
  const budgetMs = Number(request.nextUrl.searchParams.get('budgetMs')) || 50 * 60 * 1000

  try {
    const result = await runLeadSweep({ budgetMs })
    console.log('[cron/lead-sweep]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/lead-sweep] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
