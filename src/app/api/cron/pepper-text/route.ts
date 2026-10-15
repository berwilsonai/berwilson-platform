/**
 * GET /api/cron/pepper-text
 *
 * The morning text, and on Mondays the week ahead. Driven by a launchd job
 * (com.berwilson.cron-pepper-text) at 06:45 weekdays — five minutes AHEAD of
 * the email note, because a text is what gets read first and the email is
 * where the detail waits.
 *
 * ⚠ IT SHARES THE NOTE'S ASSEMBLY AND ADDS NOTHING OF ITS OWN. `assembleCommon`
 * and `assembleForMember` are the same calls the 06:50 email makes, so the two
 * messages cannot disagree about what you owe — §12: one quantity, one
 * definition, or the reader trusts none of them. The only thing this route
 * decides is what fits in four lines (src/lib/pepper/text-note.ts).
 *
 * ⚠ AN EMPTY TEXT IS NEVER SENT. A daily message that is often "nothing today"
 * teaches the reader to stop opening it, so `composeMorningText` returns a
 * REASON instead of filler and this route logs that reason and skips.
 *
 * ⚠ AND THE CHANNEL CAN BE ABSENT WITHOUT THIS BEING AN OUTAGE. Until the two
 * Shortcuts are built by hand (deploy/pepper-text-setup.md — macOS 27 removed
 * Messages' AppleScript dictionary) `notify` returns a clear error per
 * recipient and the email note, which needs none of this, still goes at 06:50.
 */

import { NextRequest, NextResponse } from 'next/server'

import { assembleCommon, assembleForMember, type PepperNote } from '@/lib/pepper/assemble'
import { composeMorningText, composeWeekAheadText } from '@/lib/pepper/text-note'
import { notify } from '@/lib/notify'
import { recordMentions, type RecordedMention } from '@/lib/pepper/memory'
import { createAdminClient } from '@/lib/supabase/admin'

/** Two assemblies, no model call. Seconds. */
export const maxDuration = 600

const CHANNEL = 'text'
const KIND = 'pepper_text'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dry') === '1'
  const force = url.searchParams.get('force') === '1'
  const only = url.searchParams.get('member')?.trim().toLowerCase() || null
  // `?kind=week` sends the week-ahead on any day, for trying it out on a
  // Tuesday rather than waiting for Monday.
  const kindParam = url.searchParams.get('kind')

  const supabase = createAdminClient()
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '') || null

  // Monday is 1. The week-ahead replaces the daily text rather than arriving
  // beside it — two texts in one minute is one text nobody reads.
  const isWeekAhead = kindParam === 'week' || (kindParam !== 'morning' && now.getDay() === 1)

  const common = await assembleCommon(now)
  const recipients = common.members.filter(
    (m) => !m.isAssistantSeat && (!only || m.email === only || m.name.toLowerCase() === only)
  )

  const alreadySent = new Set<string>()
  if (!force && !dryRun) {
    const { data: sentToday } = await supabase
      .from('notification_log')
      .select('team_member_id')
      .eq('kind', KIND)
      .eq('sent_date', today)
      .eq('status', 'sent')
    for (const row of sentToday ?? []) {
      if (row.team_member_id) alreadySent.add(row.team_member_id)
    }
  }

  const results: Record<string, unknown>[] = []
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const member of recipients) {
    if (alreadySent.has(member.id)) {
      skipped++
      results.push({ member: member.name, skipped: 'already sent today' })
      continue
    }

    let note: PepperNote
    try {
      note = await assembleForMember(member, common, now)
    } catch (err) {
      failed++
      results.push({
        member: member.name,
        error: `could not assemble: ${err instanceof Error ? err.message : String(err)}`,
      })
      continue
    }

    const composed = isWeekAhead
      ? composeWeekAheadText({ note, appUrl, now })
      : composeMorningText({ note, appUrl, now })

    if (!composed.body) {
      skipped++
      results.push({ member: member.name, skipped: composed.emptyReason })
      continue
    }

    if (dryRun) {
      results.push({ member: member.name, dryRun: true, body: composed.body })
      continue
    }

    const result = await notify({
      channel: 'text',
      to: member.email,
      // The text channel ignores the subject by design; it is carried only so
      // the one notify() signature serves every channel.
      subject: isWeekAhead ? 'Week ahead' : 'Morning',
      html: '',
      text: composed.body,
      textKind: isWeekAhead ? 'week_ahead' : 'morning',
    })

    if (result.ok) sent++
    else failed++

    /**
     * Write down what she said — AFTER the send, and from this channel too.
     *
     * ⚠ THIS CHANNEL RECORDED NOTHING UNTIL 2026-10-15, so for anyone whose
     * email note `noteIsEmpty` skips, the same two task titles went out every
     * morning with `times_named` stuck at zero: no escalation clause, no
     * rotation, forever. `recordMentions` is idempotent per DAY, so the 06:50
     * email recording the same ids a few minutes later does not double-count
     * them — and `Mention.previousMornings` is what keeps the clause honest
     * about which of the two ran first.
     */
    if (result.ok && composed.namedTaskIds.length > 0) {
      const mentioned: RecordedMention[] = composed.namedTaskIds.map((id) => ({
        kind: 'task' as const,
        itemKey: id,
      }))
      await recordMentions(member.id, mentioned, today)
    }

    results.push({
      member: member.name,
      ok: result.ok,
      ...(composed.namedTaskIds.length > 0 ? { named: composed.namedTaskIds.length } : {}),
      ...(result.error ? { error: result.error } : {}),
    })

    await supabase.from('notification_log').insert({
      team_member_id: member.id,
      channel: CHANNEL,
      kind: KIND,
      task_count: note.overdueTasks.length + note.dueSoonTasks.length,
      sent_date: today,
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : (result.error ?? 'unknown'),
    })
  }

  return NextResponse.json({
    ok: failed === 0,
    dryRun,
    kind: isWeekAhead ? 'week_ahead' : 'morning',
    candidates: recipients.length,
    sent,
    skipped,
    failed,
    results,
  })
}
