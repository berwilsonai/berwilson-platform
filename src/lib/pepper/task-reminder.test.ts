/**
 * The task reminder's shape. Pure functions, no database, no clock of their own.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { composeDueTodayText, composeWeekTaskText, type ReminderTask } from './task-reminder'

/** Monday 2026-10-19, mid-morning UTC so the ISO date is unambiguous. */
const MONDAY = new Date('2026-10-19T13:00:00Z')
/** Wednesday of the same week. */
const WEDNESDAY = new Date('2026-10-21T13:00:00Z')

const MEMBER = { name: 'Richard White' }
const APP = 'https://richards-mac-studio.tail9acc02.ts.net'

function task(over: Partial<ReminderTask> & { id: string }): ReminderTask {
  return {
    title: 'A task',
    why: null,
    due_date: null,
    assignee_id: 'm1',
    project_name: null,
    opportunity_name: null,
    project_id: null,
    opportunity_id: null,
    commitment_id: null,
    tier: 'tagged',
    ...over,
  }
}

const week = (tasks: ReminderTask[], now = MONDAY) =>
  composeWeekTaskText({ member: MEMBER, tasks, appUrl: APP, now })
const day = (tasks: ReminderTask[], now = WEDNESDAY) =>
  composeDueTodayText({ member: MEMBER, tasks, appUrl: APP, now })

// ── What is said, and what is not ───────────────────────────────────────────

test('a week with nothing dated returns a REASON, not a cheerful nothing', () => {
  // This channel has no second message to fall back on now, so a weekly
  // "nothing due" is how it stops being opened.
  const r = week([task({ id: 'a' }), task({ id: 'b', due_date: '2026-12-01' })])
  assert.equal(r.body, '')
  assert.match(r.emptyReason ?? '', /due date/)
  assert.deepEqual(r.namedTaskIds, [])
})

test("Monday names the week's dated tasks, by day, in the order they happen", () => {
  const r = week([
    task({ id: 'fri', title: 'Sign the Myton LOI', due_date: '2026-10-23' }),
    task({ id: 'mon', title: 'Send Hill AFB the bonding letter', due_date: '2026-10-19' }),
    task({ id: 'wed', title: 'Steelton PSA closing', due_date: '2026-10-21' }),
  ])
  const lines = r.body.split('\n')
  const dated = lines.filter((l) => l.includes(' — '))
  assert.equal(dated.length, 3)
  // Today reads as "Today", not as its weekday: the whole point of the day
  // prefix is how long you have.
  assert.match(dated[0], /^Today — Send Hill AFB/)
  assert.match(dated[1], /^Wed — Steelton PSA/)
  assert.match(dated[2], /^Fri — Sign the Myton LOI/)
  assert.match(r.body, /3 of yours due this week/)
  assert.equal(r.namedTaskIds.length, 3)
})

test('the window is Monday to Sunday, so next week is not named twice', () => {
  // An eight-day window puts next Monday in this Monday's message and again in
  // next Monday's, and the reader cannot tell a repeat from a slip.
  const r = week([
    task({ id: 'sun', title: 'This Sunday', due_date: '2026-10-25' }),
    task({ id: 'nextmon', title: 'Next Monday', due_date: '2026-10-26' }),
  ])
  assert.match(r.body, /This Sunday/)
  assert.doesNotMatch(r.body, /Next Monday/)
  assert.match(r.body, /1 of yours due this week/)
})

test('the week window is the calendar week even on a forced midweek run', () => {
  // `?kind=week` on a Wednesday must mean the week this Monday began, not
  // Wednesday-plus-seven — otherwise a test run reports a different week from
  // the one Monday reported.
  const r = week(
    [
      task({ id: 'mon', title: 'Monday work', due_date: '2026-10-19' }),
      task({ id: 'nextmon', title: 'Next Monday', due_date: '2026-10-26' }),
    ],
    WEDNESDAY
  )
  assert.match(r.body, /Monday work/)
  assert.doesNotMatch(r.body, /Next Monday/)
})

test('last week is carried, counted apart, and never folded into this week', () => {
  // §12: two quantities, two words, never summed.
  const r = week([
    task({ id: 'now', title: 'Due Thursday', due_date: '2026-10-22' }),
    task({ id: 'old1', title: 'Fairbanks contract', due_date: '2026-10-09' }),
    task({ id: 'old2', title: 'Delta rezone exhibit', due_date: '2026-10-02' }),
  ])
  assert.match(r.body, /1 of yours due this week/)
  assert.match(r.body, /2 still overdue: /)
  assert.match(r.body, /Delta rezone exhibit/)
  assert.equal(r.taskCount, 3)
})

test('an overdue-only week still sends, and does not claim work this week', () => {
  const r = week([task({ id: 'old', title: 'Fairbanks contract', due_date: '2026-09-30' })])
  assert.notEqual(r.body, '')
  assert.match(r.body, /Nothing of yours due this week itself/)
  assert.match(r.body, /1 still overdue/)
})

// ── Which rows get named when there are more than fit ───────────────────────

test('the live tier decides who is named, so a stranger cannot fill the message', () => {
  // The exact failure lib/tasks/priority.ts exists for: the board sorted by due
  // date alone, so the loudest row was always whichever stranger's RFP closed
  // soonest. Six dated tasks, five slots — the unattached one must lose even
  // though it is first chronologically.
  const tasks = [
    task({ id: 'rfp', title: 'Some RFP nobody asked for', due_date: '2026-10-19', tier: 'unattached' }),
    ...['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      task({ id, title: `Live deal ${id}`, due_date: `2026-10-2${i}`, tier: 'live' })
    ),
  ]
  const r = week(tasks)
  assert.equal(r.namedTaskIds.length, 5)
  assert.ok(!r.namedTaskIds.includes('rfp'), 'the unattached RFP should not have been named')
  assert.match(r.body, /\+1 more this week/)
  // Counted even though it was not named — a withheld row still exists (§12).
  assert.match(r.body, /6 of yours due this week/)
})

test('forty dated tasks still produce a message that fits a phone', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    task({ id: `t${i}`, title: `Task number ${i} with a reasonably long title`, due_date: '2026-10-22' })
  )
  const r = week(many)
  assert.ok(r.body.length <= 520, `body was ${r.body.length} characters`)
  assert.match(r.body, /40 of yours due this week/)
})

// ── The day of ──────────────────────────────────────────────────────────────

test('the day-of reminder is silent when nothing is due today', () => {
  const r = day([
    task({ id: 'tom', title: 'Due tomorrow', due_date: '2026-10-22' }),
    task({ id: 'late', title: 'Overdue already', due_date: '2026-10-01' }),
  ])
  assert.equal(r.body, '')
  assert.match(r.emptyReason ?? '', /due today/)
})

test('the day-of reminder carries today ONLY, never today plus everything late', () => {
  // It is the message that can arrive four mornings running, so what keeps it
  // worth opening is that it says something that became true today. Overdue
  // work is Monday's business.
  const r = day([
    task({ id: 'today', title: 'Steelton PSA closing', due_date: '2026-10-21' }),
    task({ id: 'late', title: 'Fairbanks contract', due_date: '2026-09-30' }),
  ])
  assert.match(r.body, /Steelton PSA closing/)
  assert.doesNotMatch(r.body, /Fairbanks/)
  assert.match(r.body, /1 task still open/)
  assert.equal(r.taskCount, 1)
})

test('the day-of reminder counts what it could not name', () => {
  const five = Array.from({ length: 5 }, (_, i) =>
    task({ id: `t${i}`, title: `Thing ${i}`, due_date: '2026-10-21' })
  )
  const r = day(five)
  assert.match(r.body, /5 tasks still open/)
  assert.match(r.body, /\+2 more due today/)
  assert.equal(r.namedTaskIds.length, 3)
})

// ── Shaping ─────────────────────────────────────────────────────────────────

test('the record is appended only when the title does not already name it', () => {
  const r = day([
    task({ id: 'a', title: 'Steelton PSA closing', due_date: '2026-10-21', project_name: 'Steelton' }),
    task({ id: 'b', title: 'Send the letter of support', due_date: '2026-10-21', project_name: 'Myton Rail' }),
  ])
  assert.match(r.body, /Steelton PSA closing$/m)
  assert.match(r.body, /Send the letter of support \(Myton Rail\)/)
})

test('an opportunity names itself too, not just a project', () => {
  const r = day([
    task({ id: 'a', title: 'Price the tranche', due_date: '2026-10-21', opportunity_name: 'Whiskey (TX)' }),
  ])
  assert.match(r.body, /Price the tranche \(Whiskey \(TX\)\)/)
})

test('a message without APP_URL has no dangling link line', () => {
  const r = composeWeekTaskText({
    member: MEMBER,
    tasks: [task({ id: 'a', title: 'A thing', due_date: '2026-10-21' })],
    appUrl: null,
    now: MONDAY,
  })
  assert.ok(!r.body.includes('http'))
  // §12: a bare value at its own weight reads as a failed render. No empty
  // trailing line either.
  assert.equal(r.body, r.body.trimEnd())
})

test('the link is the task board, which is where one gets ticked off', () => {
  const r = week([task({ id: 'a', title: 'A thing', due_date: '2026-10-21' })])
  assert.ok(r.body.endsWith(`${APP}/tasks`))
})

test('a due date is read as a plain date, never shifted by a timezone', () => {
  // `due_date` is a date column with no instant in it. Reading it in a zone
  // behind UTC moves it a day backwards, which is how a Monday deadline comes
  // out as Sunday — and the day prefix is the whole content of the line.
  const r = week([task({ id: 'a', title: 'Monday thing', due_date: '2026-10-19' })], WEDNESDAY)
  assert.match(r.body, /^Mon — Monday thing/m)
})

// ── Work nobody owns ────────────────────────────────────────────────────────

test('a dated task with no owner is named on Monday, counted apart', () => {
  // Measured 2026-10-21: four of ten dated open tasks had no assignee and three
  // were already overdue. Every per-person surface groups by assignee, so none
  // of them could say a word about those three.
  const r = week(
    [task({ id: 'mine', title: 'Mine, Thursday', due_date: '2026-10-22' })],
    MONDAY
  )
  assert.doesNotMatch(r.body, /no owner/)

  const withOrphans = composeWeekTaskText({
    member: MEMBER,
    tasks: [task({ id: 'mine', title: 'Mine, Thursday', due_date: '2026-10-22' })],
    unassigned: [
      task({ id: 'o1', title: 'Finalize and Submit CRISI Predevelopment Application', due_date: '2026-06-25' }),
      task({ id: 'o2', title: 'Secure Duchesne County Authorization', due_date: '2026-06-25' }),
      task({ id: 'o3', title: 'Review garage plans and submit pricing', due_date: '2026-09-19' }),
    ],
    appUrl: APP,
    now: MONDAY,
  })
  assert.match(withOrphans.body, /3 dated tasks with no owner \(3 already overdue\)/)
  // Named apart from the reader's own count, never summed into it (§12).
  assert.match(withOrphans.body, /1 of yours due this week/)
})

test('an unowned deadline past this week is not dragged in', () => {
  const r = composeWeekTaskText({
    member: MEMBER,
    tasks: [task({ id: 'mine', title: 'Mine', due_date: '2026-10-22' })],
    unassigned: [task({ id: 'far', title: 'Something in December', due_date: '2026-12-01' })],
    appUrl: APP,
    now: MONDAY,
  })
  assert.doesNotMatch(r.body, /no owner/)
})

test('unowned work alone does NOT send — it rides along or waits', () => {
  // Found against the live corpus 2026-10-21: Eric had no dated task this week,
  // so his entire Monday message would have been three overdue tasks that are
  // not his — the same line, to both of them, every Monday until somebody
  // picked one up. §12: flawless delivery of a number that cannot go down.
  const r = composeWeekTaskText({
    member: MEMBER,
    tasks: [],
    unassigned: [task({ id: 'o1', title: 'Case Garage pricing', due_date: '2026-09-19' })],
    appUrl: APP,
    now: MONDAY,
  })
  assert.equal(r.body, '')
  assert.match(r.emptyReason ?? '', /of theirs/)
})

test('an overdue task of their own does carry the unowned line', () => {
  const r = composeWeekTaskText({
    member: MEMBER,
    tasks: [task({ id: 'late', title: 'Mine, late', due_date: '2026-10-05' })],
    unassigned: [task({ id: 'o1', title: 'Case Garage pricing', due_date: '2026-09-19' })],
    appUrl: APP,
    now: MONDAY,
  })
  assert.match(r.body, /1 still overdue/)
  assert.match(r.body, /1 dated task with no owner/)
})

test('the greeting is separated from the rows, and the link from both', () => {
  // `.filter(Boolean)` used to drop the blank line along with an unset link,
  // welding the greeting onto the first task.
  const r = week([task({ id: 'a', title: 'A thing', due_date: '2026-10-21' })])
  const lines = r.body.split('\n')
  assert.equal(lines[1], '', 'no blank line after the greeting')
  assert.equal(lines[lines.length - 2], '', 'no blank line before the link')
  assert.ok(lines[0].startsWith('Week ahead'))
})

test('the day-of message never mentions unowned work', () => {
  // It would put the same row in front of both of them four mornings a week
  // without it ever becoming either one's.
  const r = composeDueTodayText({
    member: MEMBER,
    tasks: [task({ id: 'a', title: 'Mine today', due_date: '2026-10-21' })],
    unassigned: [task({ id: 'o', title: 'Nobody owns this', due_date: '2026-10-21' })],
    appUrl: APP,
    now: WEDNESDAY,
  })
  assert.match(r.body, /Mine today/)
  assert.doesNotMatch(r.body, /Nobody owns this/)
  assert.doesNotMatch(r.body, /no owner/)
})
