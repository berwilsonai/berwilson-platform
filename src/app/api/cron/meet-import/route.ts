import { NextRequest, NextResponse } from 'next/server'
import { importMeetTranscripts } from '@/lib/meetings/meet-import'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'

/**
 * GET /api/cron/meet-import
 *
 * Pulls new Google Meet transcripts out of the executives' Drives and stages
 * them for review at /intake (Meeting tab). Runs on com.berwilson.cron-meet-import.
 *
 * Unlike the Drive knowledge sync, an unconfigured Google IS reported as a
 * failure here rather than skipped quietly: if mail and Drive credentials are
 * gone, meetings silently stop arriving, and "no new meetings" looks exactly
 * like "everything is fine". That confusion is the failure mode /settings/health
 * exists to prevent.
 */
export const maxDuration = 1800

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: 'Google Workspace is not configured — Meet transcripts cannot be read.' },
      { status: 503 }
    )
  }

  const budgetMs = Number(request.nextUrl.searchParams.get('budgetMs')) || 25 * 60 * 1000
  const limit = Number(request.nextUrl.searchParams.get('limit')) || undefined

  try {
    const result = await importMeetTranscripts({ budgetMs, limit })
    console.log('[cron/meet-import]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/meet-import] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
