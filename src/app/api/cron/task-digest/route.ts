/**
 * GET /api/cron/task-digest
 *
 * Emails each active team member a personal digest of their overdue + due-this-week
 * tasks. Driven by a launchd job weekday mornings (com.berwilson.cron-task-digest).
 * Quiet for members with nothing due.
 *
 * The email carries the task list inline (not just a link) so it's useful even when
 * the member is off the tailnet and can't reach the app. Idempotent per member per
 * day via notification_log — a second run the same day skips anyone already sent.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildMemberDigests, renderDigestEmail } from '@/lib/notify/task-digest'
import { notify } from '@/lib/notify'

export const maxDuration = 300

const KIND = 'task_digest'
const CHANNEL = 'email'

export async function GET(request: NextRequest) {
  // Verify cron secret (fail closed if the secret is not configured)
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')

  const digests = await buildMemberDigests(supabase, now)

  // Who already got today's digest? (Tolerate the table not existing yet.)
  const alreadySent = new Set<string>()
  const { data: sentToday } = await supabase
    .from('notification_log')
    .select('team_member_id')
    .eq('kind', KIND)
    .eq('sent_date', today)
    .eq('status', 'sent')
  for (const row of sentToday ?? []) {
    if (row.team_member_id) alreadySent.add(row.team_member_id)
  }

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const digest of digests) {
    if (alreadySent.has(digest.memberId)) {
      skipped++
      continue
    }

    const { subject, html } = renderDigestEmail(digest, appUrl, now)
    const result = await notify({ channel: CHANNEL, to: digest.email, subject, html })

    const taskCount = digest.overdue.length + digest.dueSoon.length
    await supabase.from('notification_log').insert({
      team_member_id: digest.memberId,
      channel: CHANNEL,
      kind: KIND,
      task_count: taskCount,
      sent_date: today,
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : result.error ?? 'unknown',
    })

    if (result.ok) sent++
    else {
      failed++
      console.error(`[task-digest] send failed for ${digest.email}: ${result.error}`)
    }
  }

  return NextResponse.json({ success: true, candidates: digests.length, sent, skipped, failed })
}
