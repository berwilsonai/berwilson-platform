import { NextRequest, NextResponse } from 'next/server'
import { syncContactsToWorkspace } from '@/lib/contacts/workspace-sync'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'

/**
 * GET /api/cron/contacts-sync
 *
 * Pushes the parties directory into every mailbox's Google Contacts so CRM
 * contacts autocomplete in Gmail for people who cannot reach the tailnet.
 * Nightly, via com.berwilson.cron-contacts-sync.
 *
 * Unconfigured is not an error — a 503 in the log every night is noise, and the
 * platform works fine without the sync.
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

  const budgetMs = Number(request.nextUrl.searchParams.get('budgetMs')) || 10 * 60 * 1000

  try {
    const result = await syncContactsToWorkspace({ budgetMs })
    console.log('[cron/contacts-sync]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/contacts-sync] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
