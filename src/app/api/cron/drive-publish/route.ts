import { NextRequest, NextResponse } from 'next/server'
import { reconcileDrivePublishing } from '@/lib/drive/reconcile'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'

/**
 * GET /api/cron/drive-publish
 *
 * Publishes every record document that has not yet reached Drive, so the folder
 * the team is told to look in actually reflects the platform. Nightly, via
 * com.berwilson.cron-drive-publish.
 *
 * Generous duration: a bid package is several large PDFs, each downloaded from
 * storage and uploaded to Google.
 */
export const maxDuration = 1800

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isGoogleConfigured()) {
    return NextResponse.json({ skipped: true, reason: 'Google Workspace is not configured.' })
  }

  const budgetMs = Number(request.nextUrl.searchParams.get('budgetMs')) || 20 * 60 * 1000

  try {
    const result = await reconcileDrivePublishing({ budgetMs })
    console.log('[cron/drive-publish]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/drive-publish] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
