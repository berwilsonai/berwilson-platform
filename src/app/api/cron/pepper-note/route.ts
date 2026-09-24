/**
 * GET /api/cron/pepper-note
 *
 * Pepper's morning note — one email per executive, addressed to them, carrying
 * what they owe, what they are owed, their day, and the decisions waiting on
 * them. Driven by a launchd job on weekday mornings
 * (com.berwilson.cron-pepper-note).
 *
 * WHY THIS EXISTS ALONGSIDE THE DIGEST. The daily digest is one document about
 * the portfolio posted to one Chat space; `team_members` has no notification
 * preference and the only per-person channel the platform has ever had is the
 * Monday task digest. Measured on 2026-09-24: 80 staged deals were waiting on a
 * click, 67 of them more than two weeks old, while 220 open commitments sat in
 * a panel nobody was being sent to. Nothing was ever addressed to a person.
 *
 * ⚠ TIMING IS A CORRECTNESS CONSTRAINT, NOT A PREFERENCE. LM Studio serves one
 * request at a time and there is no concurrency control anywhere in this repo —
 * only wall-clock budgets. This runs at 06:50, after the 06:30 weekly brief and
 * before the 07:00 digest, and makes one model call per person, sequentially.
 * Moving it on top of either neighbour queues both behind the same GPU.
 *
 * Idempotent per member per day via notification_log, the same guard the task
 * digest uses — and see the comment there about that write failing silently.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callGemini } from '@/lib/ai/gemini'
import { notify } from '@/lib/notify'
import { SYSTEM_USER_ID } from '@/lib/system-user'
import {
  assembleCommon,
  assembleForMember,
  noteIsEmpty,
  type PepperNote,
} from '@/lib/pepper/assemble'
import { renderNoteInput } from '@/lib/pepper/render'
import { renderNoteEmail } from '@/lib/pepper/email'
import {
  PEPPER_NOTE_SYSTEM_PROMPT,
  PEPPER_NOTE_PROMPT_VERSION,
} from '@/lib/pepper/prompt'

/**
 * One long local-model call PER PERSON, run one after another. Matches the
 * digest's ceiling and sits above LOCAL_AI_TIMEOUT_MS so a genuinely stalled
 * model is caught by its own guard rather than by a client-side cut-off on a
 * run that actually succeeded.
 */
export const maxDuration = 1800

const KIND = 'pepper_note'
const CHANNEL = 'email'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dry') === '1'
  const force = url.searchParams.get('force') === '1'
  const only = url.searchParams.get('member')?.trim().toLowerCase() || null

  const supabase = createAdminClient()
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')

  const common = await assembleCommon(now)

  // The assistant's own seat holds a login and a task list, but it is not a
  // person and has no one to read its mail.
  const recipients = common.members.filter(
    (m) => !m.isAssistantSeat && (!only || m.email === only || m.name.toLowerCase() === only)
  )

  /**
   * Pepper sends as herself.
   *
   * The first live note arrived From "Ber Intelligence <moose@berwilson.com>",
   * which is Richard's OWN address — so a note written to him looked like mail
   * he had sent himself. The assistant seat is a real mailbox holding real
   * send scope, and a note signed by a name is the whole premise.
   *
   * Falls back to the platform sender only when no assistant seat exists at
   * all; a seat that exists but cannot send fails loudly, because a silent
   * fallback would quietly restore exactly the confusion this fixes.
   */
  const seat = common.members.find((m) => m.isAssistantSeat)

  // Who already got today's note? Tolerates the table being unreadable.
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

  // SEQUENTIAL, deliberately. Each iteration is one call to a model that serves
  // one request at a time; running these in parallel just queues them behind
  // each other while holding two sets of rows in memory.
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
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[pepper-note] could not assemble for ${member.email}: ${message}`)
      results.push({ member: member.name, error: message })
      continue
    }

    // Nothing to say is a real outcome. A note that arrives every morning
    // saying "nothing today" is the fastest way to teach someone to filter it.
    if (noteIsEmpty(note)) {
      skipped++
      results.push({ member: member.name, skipped: 'nothing outstanding' })
      continue
    }

    const input = renderNoteInput(note)

    let markdown: string
    try {
      const { data: composed } = await callGemini<string>({
        task: 'pepper-note',
        systemPrompt: PEPPER_NOTE_SYSTEM_PROMPT,
        userMessage: input,
        userId: SYSTEM_USER_ID,
        promptVersion: PEPPER_NOTE_PROMPT_VERSION,
        // Prose, not JSON — jsonMode would make the model wrap a markdown
        // document in a string field and escape every newline in it.
        jsonMode: false,
      })
      markdown = typeof composed === 'string' ? composed.trim() : String(composed ?? '').trim()
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[pepper-note] model call failed for ${member.email}: ${message}`)
      results.push({ member: member.name, error: message })
      continue
    }

    if (!markdown) {
      failed++
      results.push({ member: member.name, error: 'model returned an empty note' })
      continue
    }

    const { subject, html } = renderNoteEmail({
      firstName: member.firstName,
      markdown,
      owed: note.owed.length + note.omitted.owed,
      overdueTasks: note.overdueTasks.length,
      decideTotal: note.decide.total,
      appUrl,
      now,
    })

    if (dryRun) {
      results.push({
        member: member.name,
        to: member.email,
        subject,
        markdown,
        counts: {
          owed: note.owed.length,
          awaited: note.awaited.length,
          sharedOwed: note.sharedOwed.length,
          sharedAwaited: note.sharedAwaited.length,
          overdueTasks: note.overdueTasks.length,
          dueSoonTasks: note.dueSoonTasks.length,
          meetings: note.meetings.length,
          cracks: note.cracks.length,
          decide: note.decide.total,
          omitted: note.omitted,
        },
        inputChars: input.length,
        notes: note.notes,
      })
      continue
    }

    const result = await notify({
      channel: CHANNEL,
      to: member.email,
      subject,
      html,
      from: seat?.email,
      fromName: seat ? seat.name.split(' ')[0] : undefined,
    })

    // This write IS the once-per-day guarantee, so a failure has to be loud.
    // The same guard on the task digest failed silently for five weeks because
    // the table had no API grants and the error was discarded — the run kept
    // reporting a successful send while the guarantee did not hold.
    const { error: logError } = await supabase.from('notification_log').insert({
      team_member_id: member.id,
      channel: CHANNEL,
      kind: KIND,
      task_count: note.overdueTasks.length + note.dueSoonTasks.length,
      sent_date: today,
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : (result.error ?? 'unknown'),
    })
    if (logError) {
      console.error(
        `[pepper-note] could not record the send for ${member.email} — the once-per-day guard is not holding: ${logError.message}`
      )
    }

    if (result.ok) {
      sent++
      results.push({ member: member.name, to: member.email, subject, ok: true })
    } else {
      failed++
      console.error(`[pepper-note] send failed for ${member.email}: ${result.error}`)
      results.push({ member: member.name, error: result.error })
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    candidates: recipients.length,
    sent,
    skipped,
    failed,
    results,
    notes: common.notes,
  })
}
