import { NextRequest, NextResponse } from 'next/server'
import { scanDealIntake } from '@/lib/deal-intake/scan'
import { dealIntakeFolderId } from '@/lib/integrations/google-drive'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'

/**
 * GET /api/cron/deal-intake
 *
 * Scans the Drive folder the berwilson.com deal form writes into and stages any
 * new submission as a lead. Every 15 minutes, via com.berwilson.cron-deal-intake.
 *
 * Deliberately a 503 rather than a quiet skip when Google or the folder is
 * unconfigured: if credentials lapse, submissions stop arriving, and "no new
 * deals" looks exactly like "everything is fine". The same failure shape has
 * bitten this platform repeatedly.
 *
 * Creates leads only. A project is created when a human presses Promote (§11).
 */
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: 'Google Workspace is not configured — no deal submissions can be read.' },
      { status: 503 }
    )
  }
  if (!dealIntakeFolderId()) {
    return NextResponse.json(
      { error: 'No deal intake folder configured (GOOGLE_DEAL_INTAKE_FOLDER_ID).' },
      { status: 503 }
    )
  }

  const budgetMs = Number(request.nextUrl.searchParams.get('budgetMs')) || 4 * 60 * 1000

  try {
    const result = await scanDealIntake({ budgetMs })
    console.log('[cron/deal-intake]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/deal-intake] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
