/**
 * GET /api/cron/task-reminder
 *
 * The only message the platform still sends unprompted: the tasks with a due
 * date this week. Driven by one launchd job
 * (com.berwilson.cron-task-reminder) at 06:45 on weekday mornings.
 *
 * ⚠ ONE JOB, TWO MESSAGES, AND WHICH ONE IS DECIDED BY THE DAY. Monday sends
 * the week ahead; Tuesday to Friday send nothing unless something is due THAT
 * DAY and still open. Two launchd agents for this would be two schedules to
 * keep in step and two ways to double-text somebody on a Monday — §12's rule
 * about a destination that differs only in WHERE the work lands applies to WHEN
 * as well: one pass, one parameter.
 *
 * ⚠ EMAIL MUST ARRIVE; THE TEXT IS BEST-EFFORT. Richard, 2026-10-26: *"Make
 * email the channel that must arrive."* This was text-only until then, on the
 * 10-21 instruction that Pepper's mail was held and the text was the channel
 * being read — and then a read of `info@`'s Sent folder found T-Mobile
 * rejecting the gateway (`452 … AUP#MXRT`: 6 of 13 delayed, 1 permanently
 * failed in 30 days). A reminder that arrives a day late is worse than one that
 * does not arrive, so the obligation now rides mail and the text is the nudge.
 * The hold on Pepper's OWN morning note is untouched — this kind was never in
 * it. Both carry the same words, so an empty message is still skipped rather
 * than padded. `notification_log.status` is the EMAIL's verdict (see
 * `notifyPair`), or a carrier block would mark a delivered morning `failed`.
 *
 * ⚠ A SKIP IS RECORDED, NOT JUST LOGGED. `notification_log` gets a row with
 * `status = 'skipped'` and the reason whenever there is nothing to say. §12: a
 * liveness check needs a CLOCK, and a count that has stopped growing is
 * indistinguishable from a quiet week — without the skip row, a genuinely clear
 * fortnight and a dead launchd agent look identical on /settings/health. The
 * idempotency guard reads `status = 'sent'`, so a skipped morning can still
 * send if the job is re-run after somebody adds a due date.
 *
 * ⚠ NO MODEL CALL. See the composer's header: everything here is already a fact.
 */

import { NextRequest, NextResponse } from 'next/server'

import { notifyPair } from '@/lib/notify/pair'
import { isHeld } from '@/lib/notify/policy'
import { loadPepperMembers } from '@/lib/pepper/attribution'
import {
  composeDueTodayText,
  composeWeekTaskText,
  type ReminderTask,
  type TaskReminder,
} from '@/lib/pepper/task-reminder'
import { loadLiveContext, taskTier } from '@/lib/tasks/priority'
import { fetchTasksForDigest } from '@/lib/tasks/queries'
import { createAdminClient } from '@/lib/supabase/admin'

/** Two reads and a handful of sends. Nothing long-running. */
export const maxDuration = 300

/**
 * What the `notification_log` row records as the transport.
 *
 * ⚠ ONE ROW PER PERSON PER MORNING, STILL. The idempotency guard reads
 * `status = 'sent'` for the kind and date, so splitting this into a row per
 * channel would make a re-run send the half that had failed AND the half that
 * had not. The row's status is the email's — the channel that must arrive —
 * and what became of the text goes in `error` beside it, which is where a
 * best-effort note belongs: visible, never fatal.
 */
const CHANNEL = 'email+text'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dry') === '1'
  const force = url.searchParams.get('force') === '1'
  const only = url.searchParams.get('member')?.trim().toLowerCase() || null
  /** `?kind=week` tries Monday's message on a Tuesday; `?kind=today` the reverse. */
  const kindParam = url.searchParams.get('kind')

  const supabase = createAdminClient()
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '') || null

  // Monday is 1.
  const isWeek = kindParam === 'week' || (kindParam !== 'today' && now.getDay() === 1)
  const kind = isWeek ? ('task_week' as const) : ('task_due_today' as const)

  // The backstop, said out loud. A held kind returns here rather than
  // assembling, so turning the channel off costs nothing — and the response
  // says which switch did it instead of reporting zero sends.
  if (isHeld(kind)) {
    return NextResponse.json({
      ok: true,
      held: kind,
      detail: 'Held in src/lib/notify/policy.ts — nothing was assembled or sent.',
    })
  }

  const [members, tasks, live] = await Promise.all([
    loadPepperMembers(supabase),
    // ⚠ UNOWNED TASKS INCLUDED, WHICH NO OTHER READER OF THIS FUNCTION DOES.
    // Every per-person surface groups by assignee, so a dated task with no
    // owner reaches nobody — measured 2026-10-21: four of ten dated open tasks,
    // three of them already overdue. Monday's message names them once, as a
    // count, to both readers; see `ReminderInput.unassigned`.
    fetchTasksForDigest(supabase, { includeUnassigned: true }),
    loadLiveContext(now),
  ])

  const recipients = members.filter(
    (m) => !m.isAssistantSeat && (!only || m.email === only || m.name.toLowerCase() === only)
  )

  const alreadySent = new Set<string>()
  if (!force && !dryRun) {
    const { data: sentToday } = await supabase
      .from('notification_log')
      .select('team_member_id')
      .eq('kind', kind)
      .eq('sent_date', today)
      .eq('status', 'sent')
    for (const row of sentToday ?? []) {
      if (row.team_member_id) alreadySent.add(row.team_member_id)
    }
  }

  const unassigned: ReminderTask[] = tasks
    .filter((t) => !t.assignee_id)
    .map((t) => ({ ...t, tier: taskTier(t, live) }))

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

    const mine: ReminderTask[] = tasks
      .filter((t) => t.assignee_id === member.id)
      .map((t) => ({ ...t, tier: taskTier(t, live) }))

    const composed: TaskReminder = isWeek
      ? composeWeekTaskText({ member, tasks: mine, unassigned, appUrl, now })
      : // Deliberately NOT passed to the day-of message: an unowned task would
        // then be in front of both of them four mornings a week without ever
        // becoming either one's. Monday is where "who picks this up" belongs.
        composeDueTodayText({ member, tasks: mine, appUrl, now })

    if (!composed.body) {
      skipped++
      results.push({ member: member.name, skipped: composed.emptyReason })
      if (!dryRun) {
        await recordSend(supabase, {
          memberId: member.id,
          kind,
          taskCount: 0,
          sentDate: today,
          status: 'skipped',
          error: composed.emptyReason,
        })
      }
      continue
    }

    if (dryRun) {
      results.push({ member: member.name, dryRun: true, body: composed.body })
      continue
    }

    const result = await notifyPair({
      kind,
      to: member.email,
      // The EMAIL's subject. The text channel uses its own ('Pepper'), because
      // a carrier renders a subject into the body where there is no room for a
      // header — see `gatewaySender`.
      // ⚠ NO COUNT IN THE SUBJECT, AND THE FIRST VERSION OF THIS LINE IS WHY.
      // It read `Your week: ${taskCount} tasks with a date` and landed in Eric's
      // mailbox saying **7** above a body saying **5 of yours due this week** —
      // because `taskCount` is `thisWeek + overdue` and the body reports those
      // two apart, which is right. §12: two different quantities must be named
      // apart and never summed, and one quantity must have one definition or the
      // reader trusts neither. The body owns the numbers; the subject just says
      // which message this is.
      subject: isWeek ? 'Your week ahead' : 'Due today',
      text: composed.body,
    })

    // ⚠ THE VERDICT IS THE EMAIL'S. A text the carrier blocked is a note, not
    // a failure — folding it in would mark a morning that WAS delivered
    // `failed`, and the next re-run would then send it twice.
    if (result.emailed) sent++
    else failed++

    results.push({
      member: member.name,
      ok: result.emailed,
      emailed: result.emailed,
      texted: result.texted,
      named: composed.namedTaskIds.length,
      ...(result.error ? { error: result.error } : {}),
      ...(result.textNote ? { textNote: result.textNote } : {}),
    })

    await recordSend(supabase, {
      memberId: member.id,
      kind,
      taskCount: composed.taskCount,
      sentDate: today,
      status: result.emailed ? 'sent' : 'failed',
      error: result.emailed ? result.textNote : (result.error ?? 'unknown'),
    })
  }

  return NextResponse.json({
    ok: failed === 0,
    dryRun,
    kind,
    candidates: recipients.length,
    unowned: unassigned.filter((t) => t.due_date).length,
    sent,
    skipped,
    failed,
    ...(live.error ? { tierWarning: `tiers unavailable: ${live.error}` } : {}),
    results,
  })
}

/**
 * One row per member per morning, whatever happened.
 *
 * ⚠ `status` IS PLAIN TEXT WITH NO CHECK, which is what lets 'skipped' exist
 * without a migration — verified against the table definition rather than
 * assumed, because a value outside a CHECK discards the whole INSERT (§12) and
 * a failed audit row here would make the health card blind in exactly the way
 * this row exists to prevent.
 */
async function recordSend(
  supabase: ReturnType<typeof createAdminClient>,
  args: {
    memberId: string
    kind: 'task_week' | 'task_due_today'
    taskCount: number
    sentDate: string
    status: 'sent' | 'failed' | 'skipped'
    error: string | null
  }
) {
  const { error } = await supabase.from('notification_log').insert({
    team_member_id: args.memberId,
    channel: CHANNEL,
    kind: args.kind,
    task_count: args.taskCount,
    sent_date: args.sentDate,
    status: args.status,
    error: args.error,
  })
  if (error) console.error('[cron/task-reminder] could not record the send:', error.message)
}
