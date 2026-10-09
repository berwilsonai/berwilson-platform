/**
 * GET /api/cron/meeting-prep
 *
 * The pre-meeting nudge: who you are about to meet, when you last spoke to
 * them, and what is open with them in either direction — sent ~20 minutes
 * before each external meeting. Driven by a launchd job every 15 minutes
 * through the working day (com.berwilson.cron-meeting-prep).
 *
 * WHY IT EXISTS WHEN THE MORNING NOTE ALREADY HAS THE DAY. It has the same
 * facts and delivers them at 06:50, so for a 4pm meeting they are read nine
 * hours early and remembered by nobody. The note still carries the shape of the
 * day; this is the briefing at the moment it changes what somebody says.
 *
 * ⚠ NO MODEL CALL ANYWHERE IN THIS PASS. LM Studio serves one request at a time
 * and nothing in this repo queues, so a job firing every fifteen minutes that
 * wanted the GPU would sit in front of the agent all day. Everything sent is
 * already a fact; §12 — print the figure, do not make the model repeat it.
 * That is also why this is safe to schedule across the 06:30/06:50/07:00 block,
 * unlike every other cron here.
 *
 * ⚠ IDEMPOTENT ON THE CALENDAR EVENT, NOT ON THE DAY. notification_log's
 * (team_member_id, kind, sent_date) guard is right for one message a day and
 * wrong here — a second meeting would read as already sent. `dedupe_key` holds
 * the event id, and the unique (kind, dedupe_key) constraint means the INSERT
 * itself is the lock: a duplicate answers 23505 and the send is skipped, which
 * is race-free in a way a read-then-write is not.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notify } from '@/lib/notify'
import { loadPepperMembers } from '@/lib/pepper/attribution'
import { internalSet, prepsForMember, renderPrepEmail } from '@/lib/pepper/meeting-prep'

/** Several calendar reads plus a handful of sends. Nothing long-running. */
export const maxDuration = 300

const KIND = 'meeting_prep'
const CHANNEL = 'email'

/** Postgres unique-violation. The guard working, not an error to report. */
const UNIQUE_VIOLATION = '23505'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dry') === '1'

  const supabase = createAdminClient()
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  const members = await loadPepperMembers(supabase)

  /**
   * Who counts as "us" — domains AND the personal addresses on the roster's own
   * contact records. A nudge about a meeting between the two executives is
   * exactly the padding that teaches someone to filter a channel, and a
   * domain-only test let one through because Richard attends some meetings from
   * the Gmail address his `parties` row carries.
   */
  const internal = internalSet(members)

  const recipients = members.filter((m) => !m.isAssistantSeat)

  const results: Record<string, unknown>[] = []
  const notes: string[] = []
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const member of recipients) {
    const { preps, notes: memberNotes } = await prepsForMember(member, internal, now)
    notes.push(...memberNotes)

    for (const prep of preps) {
      const { subject, html } = renderPrepEmail(prep, member.firstName)

      if (dryRun) {
        results.push({
          member: member.name,
          subject,
          minutesAway: prep.minutesAway,
          counterparties: prep.counterparties.map((c) => ({
            name: c.name,
            lastContactDays: c.lastContactDays,
            open: c.openItems.length,
          })),
        })
        continue
      }

      /**
       * CLAIM FIRST, SEND SECOND. The insert is the lock, so two overlapping
       * cron fires cannot both send — and a send that then fails is recorded as
       * failed rather than retried, because a nudge delivered after the meeting
       * started is worse than one not delivered at all.
       */
      const { error: claimError } = await supabase.from('notification_log').insert({
        team_member_id: member.id,
        channel: CHANNEL,
        kind: KIND,
        sent_date: today,
        dedupe_key: `${member.id}:${prep.eventId}`,
        status: 'sent',
      })

      if (claimError) {
        if (claimError.code === UNIQUE_VIOLATION) {
          skipped++
          continue
        }
        // Any other failure means the guard is not holding, which has to be
        // loud: the same write failed silently on the task digest for five
        // weeks because the table had no API grants (§12).
        failed++
        console.error(
          `[meeting-prep] could not claim ${prep.eventId} for ${member.email} — the once-per-meeting guard is not holding: ${claimError.message}`
        )
        results.push({ member: member.name, subject, error: claimError.message })
        continue
      }

      const result = await notify({
        channel: CHANNEL,
        to: member.email,
        subject,
        html,
        from: members.find((m) => m.isAssistantSeat)?.email,
        fromName: 'Pepper',
      })

      if (result.ok) {
        sent++
        results.push({ member: member.name, subject, minutesAway: prep.minutesAway, ok: true })
      } else {
        failed++
        console.error(`[meeting-prep] send failed for ${member.email}: ${result.error}`)
        // The claim row stands, deliberately — see above. Marked failed so the
        // health page can see it rather than reading the run as clean.
        await supabase
          .from('notification_log')
          .update({ status: 'failed', error: result.error ?? 'unknown' })
          .eq('kind', KIND)
          .eq('dedupe_key', `${member.id}:${prep.eventId}`)
        results.push({ member: member.name, subject, error: result.error })
      }
    }
  }

  return NextResponse.json({ ok: true, dryRun, sent, skipped, failed, results, notes })
}
