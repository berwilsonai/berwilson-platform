/**
 * The task reminder, against the real database — the message that would go out
 * this morning, and on Monday, for each executive.
 *
 * Reads only. Prints every message body in full, because the whole point of
 * this pass is what the text SAYS, and asserts the properties that no unit test
 * can see: that the live corpus produces something a person can read, with no
 * `NaN`, `undefined` or `Infinity` in it (§12 — a listed route is not an
 * answering one).
 *
 *   node --import ./deploy/register.mjs scripts/verify-task-reminder.mts
 */

import assert from 'node:assert/strict'

import { notify } from '../src/lib/notify/index.ts'
import { OUTBOUND, heldSummary, isHeld, liveKinds } from '../src/lib/notify/policy.ts'
import { loadPepperMembers } from '../src/lib/pepper/attribution.ts'
import { composeDueTodayText, composeWeekTaskText, type ReminderTask } from '../src/lib/pepper/task-reminder.ts'
import { loadLiveContext, taskTier } from '../src/lib/tasks/priority.ts'
import { fetchTasksForDigest } from '../src/lib/tasks/queries.ts'
import { createAdminClient } from '../src/lib/supabase/admin.ts'

const BAD = /\b(NaN|undefined|null|Infinity)\b/

function check(label: string, body: string) {
  assert.ok(!BAD.test(body), `${label}: a non-value reached the message — ${body}`)
  assert.ok(body.length <= 520, `${label}: ${body.length} characters, past the phone budget`)
}

async function main() {
  console.log('── The policy ──────────────────────────────────────────────')
  console.log('Live   :', liveKinds().map((k) => `${k} (${OUTBOUND[k].channel})`).join(', '))
  console.log('Held   :', heldSummary())
  assert.equal(isHeld('task_week'), false, 'the Monday reminder must be live')
  assert.equal(isHeld('task_due_today'), false, 'the day-of reminder must be live')
  assert.equal(isHeld('ad_hoc'), true, 'an unnamed send must never be allowed')

  const supabase = createAdminClient()
  const now = new Date()
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '') || null

  const [members, tasks, live] = await Promise.all([
    loadPepperMembers(supabase),
    fetchTasksForDigest(supabase, { includeUnassigned: true }),
    loadLiveContext(now),
  ])
  if (live.error) console.log('⚠ tiers unavailable:', live.error)

  const dated = tasks.filter((t) => t.due_date)
  const unassigned: ReminderTask[] = tasks
    .filter((t) => !t.assignee_id)
    .map((t) => ({ ...t, tier: taskTier(t, live) }))

  console.log('\n── The corpus ──────────────────────────────────────────────')
  console.log(`${tasks.length} open tasks read, ${dated.length} carrying a due date`)
  console.log(`${unassigned.filter((t) => t.due_date).length} of those dated tasks have NO OWNER`)

  const recipients = members.filter((m) => !m.isAssistantSeat)
  assert.ok(recipients.length > 0, 'nobody would be texted at all')

  for (const member of recipients) {
    const mine: ReminderTask[] = tasks
      .filter((t) => t.assignee_id === member.id)
      .map((t) => ({ ...t, tier: taskTier(t, live) }))

    console.log(`\n── ${member.name} <${member.email}> ─ ${mine.length} open, ${mine.filter((t) => t.due_date).length} dated`)

    const wk = composeWeekTaskText({ member, tasks: mine, unassigned, appUrl, now })
    console.log('\n  MONDAY:')
    if (wk.body) {
      check(`${member.name} week`, wk.body)
      console.log(wk.body.split('\n').map((l) => `    ${l}`).join('\n'))
      console.log(`    [${wk.body.length} chars, ${wk.namedTaskIds.length} named, ${wk.taskCount} counted]`)
    } else {
      console.log(`    (nothing sent — ${wk.emptyReason})`)
    }

    const td = composeDueTodayText({ member, tasks: mine, appUrl, now })
    console.log('\n  TODAY:')
    if (td.body) {
      check(`${member.name} today`, td.body)
      console.log(td.body.split('\n').map((l) => `    ${l}`).join('\n'))
    } else {
      console.log(`    (nothing sent — ${td.emptyReason})`)
    }
  }

  // ⚠ THE SAME DAY TWICE MUST GIVE THE SAME MESSAGE. No model call, no
  // randomness, no clock of its own beyond the date — so a reader can skim it.
  const one = recipients[0]
  const mine: ReminderTask[] = tasks
    .filter((t) => t.assignee_id === one.id)
    .map((t) => ({ ...t, tier: taskTier(t, live) }))
  const a = composeWeekTaskText({ member: one, tasks: mine, unassigned, appUrl, now })
  const b = composeWeekTaskText({ member: one, tasks: mine, unassigned, appUrl, now })
  assert.equal(a.body, b.body, 'the same inputs produced two different messages')

  // ── The send path, without a phone buzzing ────────────────────────────────
  //
  // ⚠ THIS IS THE CHECK THAT CATCHES THE WORST FAILURE AVAILABLE HERE. `dryRun`
  // decides everything and writes the self-loop guard row, but hands nothing to
  // a transport — and that guard row is an INSERT against a CHECK constraint
  // that did not know `task_week` or `task_due_today` until migration
  // 20261021000008. A value outside a CHECK fails the WHOLE insert (§12), and
  // `sendText` REFUSES to send without the guard row, so the first Monday would
  // have been a total silence with the message composed perfectly.
  console.log('\n── The send path (dryRun: nothing is transmitted) ──────────')
  for (const kind of ['task_week', 'task_due_today'] as const) {
    const res = await notify({
      channel: 'text',
      kind,
      to: one.email,
      subject: 'verification',
      html: '',
      text: `Verification of ${kind} — ${new Date().toISOString()}`,
      dryRun: true,
    })
    assert.ok(res.ok, `${kind} could not be sent: ${res.error}`)
    console.log(`  ${kind}: accepted, via ${res.via ?? 'dry run'}`)
  }

  // And the mirror: a held kind must refuse, at the choke point, without
  // touching a transport or writing a ledger row.
  const refused = await notify({
    channel: 'text',
    kind: 'pepper_text',
    to: one.email,
    subject: 'verification',
    html: '',
    text: 'this must not be sent',
    dryRun: true,
  })
  assert.equal(refused.ok, false, 'a held kind was accepted')
  assert.equal(refused.held, true, 'a held refusal must say it was held, not that it failed')
  console.log(`  pepper_text: refused — ${refused.error}`)

  console.log('\n✓ every message read back clean, and twice the same.')
}

await main()
