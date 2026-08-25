import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { runLeadSweep, type LeadPhase } from '@/lib/leads/orchestrator'

export const maxDuration = 3600

const PHASES: LeadPhase[] = ['fetch', 'triage', 'score', 'expire']

/**
 * POST /api/leads/sweep — the manual "run now" control.
 *
 * Same orchestrator the daily cron drives, so both behave identically. Useful
 * for the first backfill and for re-running after a prompt change.
 */
export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: 'Google Workspace is not configured — see deploy/google-workspace-setup.md.' },
      { status: 503 }
    )
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const requested = Array.isArray(body.phases)
    ? (body.phases as string[]).filter((p): p is LeadPhase => PHASES.includes(p as LeadPhase))
    : undefined

  try {
    const result = await runLeadSweep({
      phases: requested?.length ? requested : undefined,
      budgetMs: Number(body.budgetMs) || 10 * 60 * 1000,
      sinceDays: typeof body.sinceDays === 'number' ? body.sinceDays : undefined,
      restart: body.restart === true,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/leads/sweep] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
