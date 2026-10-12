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

/** About four lines on a phone. Past this it is a document, not a text. */
const SOFT_LIMIT = 520

export interface TextNote {
  body: string
  /** Why it is empty, when it is. An empty text is never sent. */
  emptyReason: string | null
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

  const today = isoDate(now)
  const dueToday = [...note.overdueTasks, ...note.dueSoonTasks].filter(
    (t) => t.due_date && t.due_date <= today
  )
  const overdue = note.overdueTasks.filter((t) => t.due_date && t.due_date < today)

  // ── What cannot wait ──────────────────────────────────────────────────────
  if (overdue.length > 0) {
    lines.push(`${overdue.length} overdue: ${nameList(overdue.map((t) => t.title), 2)}`)
  }
  const dueNotOverdue = dueToday.filter((t) => !overdue.some((o) => o.id === t.id))
  if (dueNotOverdue.length > 0) {
    lines.push(`Due today: ${nameList(dueNotOverdue.map((t) => t.title), 2)}`)
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
    return { body: '', emptyReason: 'nothing due, no meetings, no open obligations' }
  }

  const head = `Morning${first ? `, ${first}` : ''}.`
  const tail = appUrl ? `\n${appUrl.replace(/\/$/, '')}/attention` : ''
  return { body: clamp(`${head}\n\n${lines.join('\n')}${tail}`), emptyReason: null }
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
  const meetings = note.meetings.filter(
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
    ...note.overdueTasks.map((t) => ({ when: t.due_date, what: t.title })),
    ...note.dueSoonTasks.map((t) => ({ when: t.due_date, what: t.title })),
    ...note.owed.map((c) => ({ when: c.row.due_date, what: c.row.what })),
    ...note.meetings
      .filter((m) => m.isAllDay)
      .map((m) => ({ when: m.start.slice(0, 10), what: m.subject })),
  ].filter((d): d is { when: string; what: string } => Boolean(d.when))

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
    return { body: '', emptyReason: 'no meetings, no deadlines, no open obligations this week' }
  }

  const head = `Week ahead${first ? `, ${first}` : ''}.`
  const tail = appUrl ? `\n${appUrl.replace(/\/$/, '')}/attention` : ''
  return { body: clamp(`${head}\n\n${lines.join('\n')}${tail}`), emptyReason: null }
}

// ── Shaping ──────────────────────────────────────────────────────────────────

/**
 * Keep it to a readable length, cutting at a line break rather than mid-word.
 *
 * ⚠ IT CUTS AND SAYS SO. A truncating reader with no continuation is not a
 * reader (§12) — here the continuation is the link, which is always kept.
 *
 * ⚠ AND IT IS A BACKSTOP THAT SHOULD NEVER FIRE, which the tests record rather
 * than exercise: every section above caps itself (two task titles, three
 * meetings, one ledger line) and the only unbounded string — a calendar
 * subject — is shortened at the point of use. The property worth asserting is
 * that forty overdue tasks still produce a four-line text, not that the cut
 * works. This stays because it costs nothing and the alternative, the day
 * somebody adds an uncapped section, is a wall of text at 06:50.
 */
function clamp(body: string): string {
  if (body.length <= SOFT_LIMIT) return body
  const lines = body.split('\n')
  const link = lines[lines.length - 1].startsWith('http') ? lines.pop()! : null
  let out = ''
  for (const line of lines) {
    if (out.length + line.length + 1 > SOFT_LIMIT - 40) break
    out += (out ? '\n' : '') + line
  }
  return [out, '…more in your email.', link].filter(Boolean).join('\n')
}

/** "Steelton PSA, Fairbanks contract +3 more" */
function nameList(items: string[], show: number): string {
  const shown = items.slice(0, show).map((i) => shorten(i, 44))
  const rest = items.length - shown.length
  return shown.join(', ') + (rest > 0 ? ` +${rest} more` : '')
}

function shorten(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

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

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/** "9:30" — an all-day item has no clock, and saying "00:00" would be a lie. */
function clockOf(m: { start: string; isAllDay: boolean }): string {
  if (m.isAllDay) return 'All day'
  const d = new Date(m.start)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function weekdayOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'short' })
}

/** "1 Nov" — the form a deadline gets said out loud in. */
function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
