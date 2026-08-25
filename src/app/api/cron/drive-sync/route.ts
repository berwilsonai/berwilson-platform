import { NextRequest, NextResponse } from 'next/server'
import { syncDriveKnowledge } from '@/lib/knowledge/drive-sync'
import { isDriveConfigured } from '@/lib/integrations/google-drive'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'

/**
 * GET /api/cron/drive-sync
 *
 * Indexes the nominated Drive knowledge folder into the company knowledge base,
 * which is what the fit assessor cites as evidence. Nightly, via
 * com.berwilson.cron-drive-sync.
 *
 * Unconfigured is not an error — this is optional infrastructure, and a 503 in
 * the cron log every night would be noise.
 */
export const maxDuration = 1800

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isGoogleConfigured() || !isDriveConfigured()) {
    return NextResponse.json({
      skipped: true,
      reason: 'No Drive knowledge folder configured (GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID).',
    })
  }

  const budgetMs = Number(request.nextUrl.searchParams.get('budgetMs')) || 20 * 60 * 1000

  try {
    const result = await syncDriveKnowledge({ budgetMs })
    console.log('[cron/drive-sync]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/drive-sync] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
