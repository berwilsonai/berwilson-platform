/**
 * THE ONE MESSAGE THAT STILL GOES OUT: the tasks with a due date this week.
 *
 * Richard, 2026-10-21: *"The only messaging I want to go out are reminder of
 * important tasks that have a due date that week. Send it out Monday. You can
 * send a reminder the day of if it still hasn't been checked off the tasks
 * list."*
 *
 * So there are exactly two messages here and they answer two different
 * questions. Monday's says *what is coming*; the day-of says *this one is today
 * and still open*. Everything else Pepper used to send is held
 * (`src/lib/notify/policy.ts`), which is what gives these two the whole channel.
 *
 * ⚠ A DUE DATE IS THE IMPORTANCE SIGNAL, AND THAT IS A DECISION, NOT A
 * SHORTCUT. `tasks` has no priority column and never has; what it has is a date
 * somebody chose to type. Inventing a second notion of important — a flag, a
 * score — would be a field nobody maintains, which §12 says reads as normal the
 * day it is forgotten. What the derived tier (`lib/tasks/priority.ts`) is used
 * for here is narrower and is the one place it belongs: deciding WHICH rows get
 * named when there are more than fit, so a stranger's RFP deadline cannot push
 * a live deal's task off the message. That exact failure is why the tier exists.
 *
 * ⚠ NO MODEL CALL, EVER. Every figure here is already a fact (§12 — print the
 * count, do not make the model repeat it), the box serves one model request at
 * a time, and a reminder that is sometimes late is worse than one that is
 * always plain.
 *
 * ⚠ AN EMPTY REMINDER IS NEVER SENT. Both composers return a REASON instead of
 * a cheerful nothing. A weekly message that is often "nothing due" teaches the
 * reader to stop opening it, and this channel now has no second message to fall
 * back on.
 */

import type { DigestTask } from '@/lib/tasks/queries'
import type { TaskTier } from '@/lib/tasks/priority'
import { tierRank } from '@/lib/tasks/priority'
import {
  addDays,
  clamp as clampTo,
  firstName,
  isoDate,
  nameList,
  shorten,
  weekdayOf,
} from './text-shape'

/** A task with the tier the board already derives for it. */
export interface ReminderTask extends DigestTask {
  tier: TaskTier
}

export interface TaskReminder {
  /** Empty when there is nothing to say; the caller sends nothing. */
  body: string
  /** Why it is empty, when it is — so a skip is readable in the cron's output. */
  emptyReason: string | null
  /** The task ids this message actually NAMED, not everything it counted. */
  namedTaskIds: string[]
  /** How many dated tasks it was about, for the notification_log row. */
  taskCount: number
}

export interface ReminderInput {
  member: { name: string }
  /** This member's OPEN tasks. Closing one is what makes it disappear. */
  tasks: ReminderTask[]
  /**
   * OPEN tasks nobody owns — the same for both readers, named once on Monday.
   *
   * ⚠ A TASK WITH A DEADLINE AND NO OWNER WAS INVISIBLE TO EVERYTHING, and the
   * measurement is the argument: of 10 open dated tasks on 2026-10-21, four had
   * no assignee and THREE were already overdue (the Myton Rail CRISI
   * application and the Duchesne County authorization, both 25 Jun, and the
   * Case Garage pricing, 19 Sep). Every per-person surface groups by assignee,
   * so none of them could ever say a word about those three. §12: a record
   * created with no owner is invisible under a default "mine" scope.
   *
   * ⚠ ONE LINE, MONDAY ONLY, AND A COUNT RATHER THAN A LIST. Both executives
   * get the same line, so making it longer would be the same nag twice; and
   * putting it on the day-of message would make an unowned task somebody's
   * problem four mornings a week without ever making it theirs. What it is for
   * is deciding who picks it up, which is a Monday question.
   */
  unassigned?: ReminderTask[]
  appUrl: string | null
  /** Overridden in tests so a fixed clock gives a fixed message. */
  now?: Date
}

/**
 * How many rows a message may name before it starts counting instead.
 *
 * Five for the week because a week is a list you read once with a coffee; three
 * for the day because a day with four things due in it is a day whose message
 * should be a prompt to open the board, not the board.
 */
const NAME_IN_WEEK = 5
const NAME_IN_DAY = 3

/** The continuation sentence, which must not promise an email that is held. */
const MORE_ON_BOARD = '…the rest are on your task board.'

/**
 * Monday: the week in front of you.
 *
 * ⚠ THE WINDOW IS MONDAY THROUGH SUNDAY, which is seven days INCLUSIVE of
 * today and not `now + 7`. An eight-day window makes next Monday's work appear
 * in this Monday's message and then again in next Monday's — the reader cannot
 * tell a repeat from a slip, and §12's finding about Pepper's own subject lines
 * is what that costs: a message whose number only grows is a message that stops
 * being read. Computed from the real weekday, so a `?kind=week` run on a
 * Wednesday still means the week this Monday began.
 */
export function composeWeekTaskText(args: ReminderInput): TaskReminder {
  const { member, tasks, appUrl, now = new Date() } = args
  const today = isoDate(now)
  // Day 0 is Monday. A Sunday run (getDay() === 0) belongs to the week that is
  // ending, not the one starting in the morning.
  const mondayOffset = (now.getDay() + 6) % 7
  const weekStart = isoDate(addDays(now, -mondayOffset))
  const weekEnd = isoDate(addDays(now, 6 - mondayOffset))

  const dated = tasks.filter((t): t is ReminderTask & { due_date: string } => Boolean(t.due_date))
  const thisWeek = dated.filter((t) => t.due_date >= weekStart && t.due_date <= weekEnd)
  // ⚠ NAMED APART AND NEVER SUMMED (§12 — one quantity, one definition). An
  // unfinished task from last week is the thing most likely to matter and the
  // thing least likely to be news, so it gets a count and two titles rather
  // than a share of the lines this week's work needs.
  const overdue = dated.filter((t) => t.due_date < weekStart)

  // ⚠ THE UNOWNED LINE RIDES ALONG; IT NEVER JUSTIFIES A SEND BY ITSELF. Both
  // readers get the identical line, and an unowned task changes only when
  // somebody picks it up — so a message consisting of nothing else would be the
  // same text to two people every Monday until one of them acted, which is
  // precisely the "flawless delivery of a number that cannot go down" §12
  // records against Pepper's own twelve subject lines. Found by running this
  // against the live corpus on 2026-10-21: Eric had no dated task this week, so
  // his whole message would have been three overdue tasks that are not his.
  if (thisWeek.length === 0 && overdue.length === 0) {
    return {
      body: '',
      emptyReason: 'no task of theirs carries a due date this week or earlier',
      namedTaskIds: [],
      taskCount: 0,
    }
  }

  const lines: string[] = []
  const named: string[] = []

  if (thisWeek.length > 0) {
    // Chosen by tier, printed by date: the five that matter, in the order they
    // happen. Picking chronologically instead would let whichever stranger's
    // bid closes soonest spend the whole message.
    const shown = [...thisWeek]
      .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.due_date.localeCompare(b.due_date))
      .slice(0, NAME_IN_WEEK)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))

    for (const t of shown) {
      const day = t.due_date === today ? 'Today' : weekdayOf(t.due_date)
      lines.push(`${day} — ${taskLabel(t)}`)
      named.push(t.id)
    }
    const rest = thisWeek.length - shown.length
    if (rest > 0) lines.push(`+${rest} more this week`)
  }

  if (overdue.length > 0) {
    lines.push(
      `${overdue.length} still overdue: ${nameList(
        [...overdue]
          .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.due_date.localeCompare(b.due_date))
          .map((t) => t.title),
        2
      )}`
    )
  }

  // ⚠ NAMED APART FROM BOTH OF THE ABOVE, because it is a third quantity: not
  // this week's work and not late work of yours, but work with a deadline that
  // nobody has picked up. Counted over the same window the message is about —
  // this week or already past — so a deadline in December is not dragged in.
  const orphans = (args.unassigned ?? []).filter(
    (t) => t.due_date && t.due_date <= weekEnd
  )
  if (orphans.length > 0) {
    const late = orphans.filter((t) => t.due_date! < weekStart).length
    lines.push(
      `${orphans.length} dated task${orphans.length === 1 ? '' : 's'} with no owner` +
        (late > 0 ? ` (${late} already overdue)` : '') +
        `: ${nameList(orphans.map((t) => t.title), 2)}`
    )
  }

  const first = firstName(member.name)
  const head =
    `Week ahead${first ? `, ${first}` : ''}. ` +
    (thisWeek.length > 0
      ? `${thisWeek.length} of yours due this week.`
      : 'Nothing of yours due this week itself.')

  return {
    body: assemble(head, lines, appUrl),
    emptyReason: null,
    namedTaskIds: [...new Set(named)],
    // The READER'S OWN count, which is what the notification_log row is about.
    // Unowned work is named in the message and deliberately not added in: §12,
    // two quantities never summed.
    taskCount: thisWeek.length + overdue.length,
  }
}

/**
 * The day of: due today, and nobody has ticked it.
 *
 * ⚠ DUE TODAY ONLY — NOT "TODAY PLUS EVERYTHING LATE". This is the one message
 * that can arrive on four consecutive mornings, and the way to keep it worth
 * opening is that it says something that becomes true that day. Overdue work is
 * carried by Monday's message, where it is one line among a list rather than
 * the whole text; putting it here as well is how a daily reminder turns into
 * the growing number §12 warns about. The task being open IS the "still hasn't
 * been checked off" test: the caller reads `status = 'open'`, so a closed task
 * is already gone before this function sees it.
 */
export function composeDueTodayText(args: ReminderInput): TaskReminder {
  const { member, tasks, appUrl, now = new Date() } = args
  const today = isoDate(now)

  const dueToday = tasks.filter(
    (t): t is ReminderTask & { due_date: string } => t.due_date === today
  )

  if (dueToday.length === 0) {
    return {
      body: '',
      emptyReason: 'nothing of theirs is due today',
      namedTaskIds: [],
      taskCount: 0,
    }
  }

  const shown = [...dueToday]
    .sort((a, b) => tierRank(a.tier) - tierRank(b.tier))
    .slice(0, NAME_IN_DAY)
  const rest = dueToday.length - shown.length
  const first = firstName(member.name)

  const lines = shown.map((t) => `• ${taskLabel(t)}`)
  if (rest > 0) lines.push(`+${rest} more due today`)

  const head =
    `Due today${first ? `, ${first}` : ''}: ` +
    `${dueToday.length} task${dueToday.length === 1 ? '' : 's'} still open.`

  return {
    body: assemble(head, lines, appUrl),
    emptyReason: null,
    namedTaskIds: shown.map((t) => t.id),
    taskCount: dueToday.length,
  }
}

/**
 * One task in as few characters as carry the point.
 *
 * ⚠ THE RECORD IS APPENDED ONLY WHEN THE TITLE DOES NOT ALREADY SAY IT. Most
 * titles name their deal ("Steelton PSA closing"), and "Steelton PSA closing
 * (Steelton)" is noise in a message whose whole budget is four lines. A title
 * that does NOT name it ("Send the letter of support") is useless without it,
 * which is the case this exists for.
 */
function taskLabel(t: ReminderTask): string {
  const title = shorten(t.title, 58)
  const record = t.project_name ?? t.opportunity_name
  if (!record) return title
  const haystack = title.toLowerCase()
  if (haystack.includes(record.toLowerCase())) return title
  return `${title} (${shorten(record, 24)})`
}

/**
 * Greeting, blank line, the rows, then the board.
 *
 * ⚠ THE BLANK LINE IS CONTENT AND WAS BEING FILTERED OUT AS THOUGH IT WERE
 * ABSENCE. Both composers built this with `[head, '', ...lines, link].filter(
 * Boolean)`, which drops an unset link and the separator alike — so the live
 * run printed the greeting welded onto the first task. Two different things
 * were being tested for truthiness; they are now two different decisions.
 */
function assemble(head: string, lines: string[], appUrl: string | null): string {
  const board = appUrl ? `${appUrl.replace(/\/$/, '')}/tasks` : null
  const parts = [head, '', ...lines]
  if (board) parts.push('', board)
  return clampTo(parts.join('\n'), MORE_ON_BOARD)
}
