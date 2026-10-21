/**
 * Pepper's morning text, and the Monday week-ahead.
 *
 * ⚠ A TEXT IS NOT A SHORTER EMAIL, AND THE EVIDENCE IS IN HER OWN SUBJECT
 * LINES. Twelve consecutive weekday notes went out with these subjects:
 * Richard 19 → 28 → 28 → 42 → 51 → 58 → 59 → 71 → 74 → 76 → 82; Eric 90 → 93 →
 * 95 → 112 → 116 → 123 → 125 → 122 → 124 → 133 → 154. The delivery was
 * flawless and the headline only ever grew, because it counted the whole
 * ledger. A text has room for about four lines, so if those four lines are a
 * number that cannot go down, the channel is spent on telling somebody they
 * are behind. ⚠ §12 already records the matching finding about colour: when
 * every row is red, red has stopped signifying.
 *
 * So the text carries only what is TODAY'S: what is due, who is coming, and
 * the one number that moved. The ledger stays in the 06:50 email, where there
 * is room for it and a link on every row.
 *
 * ⚠ AND NO MODEL CALL. Deliberately deterministic: this goes out at 06:50 on a
 * box that serves one model request at a time, behind nothing and ahead of the
 * brief. A text that is sometimes late is worse than a text that is always
 * plain — and §12's note on temperature applies doubly to something read half
 * awake: a message that is phrased differently each morning is one you stop
 * being able to skim.
 */

import type { PepperNote } from './assemble'
import {
  addDays,
  capitalize,
  clamp as clampTo,
  firstName,
  isoDate,
  nameList,
  shortDate,
  shorten,
  weekdayOf,
} from './text-shape'

/**
 * What a cut message says instead of the lines it dropped.
 *
 * ⚠ IT NAMES THE EMAIL, WHICH IS WHY IT IS A CONSTANT HERE AND NOT IN THE
 * SHARED HELPER. This pass is held as of 2026-10-21 and so is the 06:50 email
 * it points at; the sentence is only true while both come back together.
 */
const MORE_IN_EMAIL = '…more in your email.'

const clamp = (body: string) => clampTo(body, MORE_IN_EMAIL)

export interface TextNote {
  body: string
  /** Why it is empty, when it is. An empty text is never sent. */
  emptyReason: string | null
  /**
   * The task ids this message actually NAMED, for Pepper's memory.
   *
   * ⚠ THE TEXT RECORDED NOTHING, AND FOR A QUIET READER THAT MEANT IT NEVER
   * ESCALATED. Only the 06:50 email wrote mentions, and it skips anyone whose
   * note `noteIsEmpty` — so somebody with two overdue tasks and nothing else
   * got the same two titles texted every morning forever, with the count stuck
   * at zero and the rotation never engaging. What she said is what she NAMED,
   * which for this channel is the handful of titles that fit, not everything
   * the assembly held.
   */
  namedTaskIds: string[]
}

/**
 * The weekday text.
 *
 * Order is deliberate and is NOT the email's order: due-today first because it
 * is the only thing that cannot wait, then the day's meetings because they are
 * fixed points, then one line of ledger, then the link. The email leads with
 * what you owe; a text read at 06:50 leads with what happens next.
 */
export function composeMorningText(args: {
  note: PepperNote
  appUrl: string | null
  /** Overridden in tests so a fixed clock gives a fixed message. */
  now?: Date
}): TextNote {
  const { note, appUrl, now = new Date() } = args
  const lines: string[] = []
  const first = firstName(note.member.name)
  // Only the titles that actually fit — `nameList` prints TWO and counts the
  // rest, so recording all of them would claim she named what she summarised.
  const named: string[] = []

  const today = isoDate(now)
  const dueToday = [...note.overdueTasks, ...note.dueSoonTasks].filter(
    (t) => t.due_date && t.due_date <= today
  )
  const overdue = note.overdueTasks.filter((t) => t.due_date && t.due_date < today)

  // ── What cannot wait ──────────────────────────────────────────────────────
  if (overdue.length > 0) {
    lines.push(`${overdue.length} overdue: ${nameList(overdue.map((t) => t.title), 2)}`)
    named.push(...overdue.slice(0, 2).map((t) => t.id))
  }
  const dueNotOverdue = dueToday.filter((t) => !overdue.some((o) => o.id === t.id))
  if (dueNotOverdue.length > 0) {
    lines.push(`Due today: ${nameList(dueNotOverdue.map((t) => t.title), 2)}`)
    named.push(...dueNotOverdue.slice(0, 2).map((t) => t.id))
  }

  // ── Fixed points ──────────────────────────────────────────────────────────
  const todaysMeetings = note.meetings.filter((m) => m.start.slice(0, 10) === today)
  if (todaysMeetings.length > 0) {
    lines.push(
      todaysMeetings
        .slice(0, 3)
        .map((m) => {
          const who = personLabel(m.counterparties[0]?.name)
          // ⚠ The subject is SHORTENED here. Every other section caps itself
          // by item count, which is what actually keeps the message short; a
          // calendar subject is one item of unbounded length ("FW: RE: Ber
          // Wilson / Cleveland-Cliffs — Steelton, Riverdale & Weirton PSA…")
          // and was the one way a single line could run past the whole budget.
          return `${clockOf(m)} ${shorten(m.subject, 52)}${who ? ` (${who})` : ''}`
        })
        .join('\n')
    )
  }

  // ── One line of ledger, named apart and never summed ─────────────────────
  //
  // ⚠ TWO QUANTITIES, TWO WORDS. §12: one quantity, one definition, or the
  // reader trusts none of them — three "needs attention" numbers on one screen
  // were 1, 99+ and 197 because each surface summed its own list.
  // ⚠ THE DECIDE TOTAL IS DELIBERATELY NOT HERE, AND THE FIRST LIVE DRY RUN IS
  // WHY. It rendered as "272 to decide" — which is the exact failure this
  // channel was built to escape. Pepper's twelve email subject lines went
  // 19 → 82 for Richard and 90 → 154 for Eric, flawless delivery of a number
  // that could only grow, and nobody settled one of 407 commitments in eleven
  // mornings. Putting a 272 in a four-line text spends the whole message
  // telling somebody they are behind. The queue belongs in the 06:50 email,
  // which has room for it and a link on every row; what belongs here is
  // today's. Owed and waiting stay because they are per-person, small, and
  // closeable from the email's one-tap links.
  const ledger: string[] = []
  if (note.owed.length > 0) ledger.push(`you owe ${note.owed.length}`)
  if (note.awaited.length > 0) ledger.push(`waiting on ${note.awaited.length}`)
  if (ledger.length > 0) lines.push(capitalize(ledger.join(', ')))

  if (lines.length === 0) {
    // ⚠ A QUIET MORNING IS WORTH SAYING, BUT NOT EVERY MORNING. Returning a
    // reason rather than a cheerful nothing lets the caller decide; the cron
    // does not send an empty text, because a daily message that is usually
    // "nothing today" trains the reader to stop opening it.
    return { body: '', emptyReason: 'nothing due, no meetings, no open obligations', namedTaskIds: [] }
  }

  const head = `Morning${first ? `, ${first}` : ''}.`
  const tail = appUrl ? `\n${appUrl.replace(/\/$/, '')}/attention` : ''
  return {
    body: clamp(`${head}\n\n${lines.join('\n')}${tail}`),
    emptyReason: null,
    namedTaskIds: [...new Set(named)],
  }
}

/**
 * The Monday text: the week in front of you.
 *
 * ⚠ THIS IS THE MONDAY BRIEF RETARGETED, NOT A FOURTH MORNING MESSAGE. There
 * were already three sends in the 06:00–07:00 hour — the portfolio brief
 * (Mondays), this note (weekdays) and the Chat digest (weekdays), the last of
 * which says in its own source that it is "addressed to nobody". A week-ahead
 * text is what the Monday brief was always for, in the channel where somebody
 * reads it.
 */
export function composeWeekAheadText(args: {
  note: PepperNote
  appUrl: string | null
  now?: Date
}): TextNote {
  const { note, appUrl, now = new Date() } = args
  const lines: string[] = []
  const first = firstName(note.member.name)

  const weekEnd = isoDate(addDays(now, 7))
  const today = isoDate(now)

  // ⚠ AN ALL-DAY CALENDAR ENTRY IS A DEADLINE, NOT A MEETING. The live dry run
  // said "3 meetings" where two were all-day `BID DUE — …` markers. §12: one
  // quantity, one definition — counting a deadline as a meeting makes the one
  // number in the line mean two things, and the reader checks the calendar
  // anyway to find out which.
  //
  // ⚠ `weekMeetings`, NOT `meetings`. This filtered a 7-day window over a feed
  // that only ever held TODAY, so the count could never exceed Monday's and the
  // `weekdayOf()` beside it had nothing but Mondays to format. See the field's
  // own comment in ./assemble.
  const meetings = note.weekMeetings.filter(
    (m) => !m.isAllDay && m.start.slice(0, 10) >= today && m.start.slice(0, 10) <= weekEnd
  )
  if (meetings.length > 0) {
    lines.push(
      `${meetings.length} meeting${meetings.length === 1 ? '' : 's'}: ` +
        meetings
          .slice(0, 4)
          .map((m) => `${weekdayOf(m.start)} ${shorten(m.subject, 34)}`)
          .join('; ')
    )
  }

  // Deadlines from tasks, commitments AND all-day calendar markers — three
  // sources of the same kind of fact, merged here and counted once.
  const dated = [
    ...note.overdueTasks.map((t) => ({ when: t.due_date, what: t.title, taskId: t.id })),
    ...note.dueSoonTasks.map((t) => ({ when: t.due_date, what: t.title, taskId: t.id })),
    ...note.owed.map((c) => ({ when: c.row.due_date, what: c.row.what, taskId: null })),
    // Also from the week, for the same reason: a `BID DUE —` marker on Thursday
    // is exactly what a Monday text is for, and today's feed cannot see it.
    ...note.weekMeetings
      .filter((m) => m.isAllDay)
      .map((m) => ({ when: m.start.slice(0, 10), what: m.subject })),
  ].filter((d): d is { when: string; what: string; taskId: string | null } => Boolean(d.when))

  // ⚠ A LOWER BOUND, WHICH THE FIRST VERSION HAD NOT GOT. It filtered on
  // `when <= weekEnd` alone, so the live dry run reported "Due this week:
  // 9 Sept …; 18 Sept …" to Richard and "11 Feb …; 20 Feb …" to Eric — months
  // in the PAST, under a heading that said this week. 71 of 407 open
  // commitments carry a date and most of those dates are gone, so the bug was
  // guaranteed to fire on the first real Monday. Past-dated items are real and
  // belong in the note; what they are not is this week's.
  const overdue = dated.filter((d) => d.when < today)
  const thisWeek = dated
    .filter((d) => d.when >= today && d.when <= weekEnd)
    .sort((a, b) => a.when.localeCompare(b.when))

  if (overdue.length > 0) {
    lines.push(`${overdue.length} already overdue.`)
  }
  if (thisWeek.length > 0) {
    lines.push(
      `Due this week: ` +
        thisWeek
          .slice(0, 4)
          .map((d) => `${shortDate(d.when)} ${shorten(d.what, 42)}`)
          .join('; ')
    )
  }

  // Same reasoning as the morning text: two per-person quantities, no queue
  // total. See the note above `ledger` in composeMorningText.
  const ledger: string[] = []
  if (note.owed.length > 0) ledger.push(`you owe ${note.owed.length}`)
  if (note.awaited.length > 0) ledger.push(`waiting on ${note.awaited.length}`)
  if (ledger.length > 0) lines.push(capitalize(ledger.join(', ')))

  if (lines.length === 0) {
    return {
      body: '',
      emptyReason: 'no meetings, no deadlines, no open obligations this week',
      namedTaskIds: [],
    }
  }

  const head = `Week ahead${first ? `, ${first}` : ''}.`
  const tail = appUrl ? `\n${appUrl.replace(/\/$/, '')}/attention` : ''
  return {
    body: clamp(`${head}\n\n${lines.join('\n')}${tail}`),
    emptyReason: null,
    // The four `thisWeek` rows it printed, and only those — the same rule as
    // the morning text: what she named, not what the assembly held.
    namedTaskIds: [
      ...new Set(
        thisWeek
          .slice(0, 4)
          .map((d) => d.taskId)
          .filter((id): id is string => !!id)
      ),
    ],
  }
}

// ── Shaping ──────────────────────────────────────────────────────────────────
//
// ⚠ WHAT USED TO LIVE HERE IS IN `./text-shape` AND IS SHARED. clamp, nameList,
// shorten, firstName, capitalize, isoDate, addDays, weekdayOf and shortDate
// moved there when the task reminder became a second sender — §12: a fork is
// hardest to see as two sibling modules written days apart. What is left below
// is the part that needs a MEETING, which is the line between the two files.

/**
 * A counterparty's name, or nothing if all we have is an address.
 *
 * ⚠ THE LIVE DRY RUN PRINTED `Ber Wilson chat W Taylor
 * (englertmining@gmail.com)`. When a calendar attendee has never been resolved
 * to a contact, `name` IS the address — and an address in the slot where a
 * person's name goes reads as a failed render, the same way §12's bare em dash
 * does. Better to say the meeting and omit the who than to print plumbing.
 */
function personLabel(name: string | undefined): string | null {
  const n = name?.trim()
  if (!n) return null
  if (n.includes('@')) return null
  return n
}

/** "9:30" — an all-day item has no clock, and saying "00:00" would be a lie. */
function clockOf(m: { start: string; isAllDay: boolean }): string {
  if (m.isAllDay) return 'All day'
  const d = new Date(m.start)
  if (Number.isNaN(d.getTime())) return ''
  // Pinned, like render.ts/email.ts/meeting-prep.ts. Without it the clock
  // follows the server's zone, so a 4pm meeting reads as 22:00 the one time the
  // launchd environment differs from the box's own locale.
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Denver',
  })
}
