import { NextRequest, NextResponse } from 'next/server'
import { syncTaskSheet } from '@/lib/tasks/sheet'
import {
  SheetsApiDisabledError,
  SheetsScopeError,
} from '@/lib/integrations/google-sheets'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'

/**
 * GET /api/cron/task-sheet
 *
 * Reads the Done checkboxes out of the Ber Wilson Tasks workbook, settles what
 * they ask for, and rebuilds every tab from the board. Every 15 minutes, via
 * com.berwilson.cron-task-sheet.
 *
 * Replaced /api/cron/google-tasks on 2026-10-11. The cadence is carried over
 * unchanged and for the same reason: three confirm routes (meeting intake,
 * email ingestion, action items) create tasks in bulk without going through
 * /api/tasks, and "the tasks someone assigned you this morning turn up
 * tomorrow" is the wrong answer for a to-do list. It also bounds how long a
 * ticked box waits before it settles, which the old sync did not have to care
 * about because Google notified nothing either way.
 *
 * ⚠ THE TWO 403s THIS CAN RETURN MEAN COMPLETELY DIFFERENT THINGS and are
 * reported apart on purpose. `sheets_api_disabled` is one click in the Cloud
 * console and no token work; `insufficient_scope` is a mailbox re-consenting in
 * a browser. Telling them apart by reading Google's prose costs an afternoon.
 */
export const maxDuration = 300

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

  try {
    const result = await syncTaskSheet()
    console.log('[cron/task-sheet]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof SheetsApiDisabledError) {
      console.error('[cron/task-sheet] the Sheets API is not enabled:', err.message)
      return NextResponse.json(
        {
          error: 'sheets_api_disabled',
          detail: err.message,
          fix:
            'Enable the Google Sheets API on the Cloud project (APIs & Services → ' +
            'Library → Google Sheets API). No re-consent is needed; drive.file already ' +
            'covers the spreadsheets this app creates.',
        },
        { status: 503 }
      )
    }
    if (err instanceof SheetsScopeError) {
      console.error('[cron/task-sheet] insufficient scope:', err.message)
      return NextResponse.json(
        {
          error: 'insufficient_scope',
          detail: err.message,
          fix: 'node scripts/setup-google-oauth.mjs --only moose@berwilson.com',
        },
        { status: 503 }
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/task-sheet] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
