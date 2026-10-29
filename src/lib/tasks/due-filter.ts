/**
 * The due-date slice on the task board.
 *
 * ⚠ IN `src/lib`, NOT IN THE BOARD COMPONENT. §12: a helper shared between
 * server and client code must not be exported from a `'use client'` file. It
 * lives here so the board, any future server-rendered task view and the tests
 * all read one definition — and so the predicate can be tested at all, which is
 * the whole reason the rule exists.
 *
 * ⚠ THE BOARD COULD NOT SHOW YOU A TASK WITH NO DATE. Measured 2026-10-29:
 * **41 open tasks, of which 37 carry no due date — 90% of the board** — and 13
 * have no owner. There was an `unassigned` option on the assignee filter and no
 * date filter at all, so nine rows in ten were reachable only by scrolling past
 * the handful that were dated. A backlog you cannot select is one nobody drains.
 *
 * ⚠ THE FIRST MEASUREMENT OF THIS WAS WRONG AND IS WORTH THE LINE. It counted
 * `status <> 'completed'` and reported 146 open, 89 undated, 45 overdue. The
 * column holds `open` and `done` — there is no `completed` — so the predicate
 * was true for every row in the table and swept in all 105 finished ones. §12:
 * check what the values ARE before filtering on one. The real overdue count is
 * **2**, not 45; the undated share got worse, not better.
 *
 * ⚠ AND THIS IS A VIEW, NOT A NEW NOTION OF IMPORTANCE. `task-reminder.ts`
 * records the decision that a due date IS the importance signal, and that
 * inventing a second one — a flag, a score — would be a field nobody maintains.
 * Nothing here scores anything; it slices on a column that is either set or not.
 */

/** ⚠ The array is the source: `useUrlState` validates against it, so a value
 * that is not a member cannot arrive from the query string. */
export const DUE_FILTERS = ['all', 'overdue', 'week', 'undated'] as const
export type DueFilter = (typeof DUE_FILTERS)[number]

/** Declaration order is reading order — this is what the select renders. */
export const DUE_FILTER_LABELS: Record<DueFilter, string> = {
  all: 'Any date',
  overdue: 'Overdue',
  week: 'Next 7 days',
  undated: 'No due date',
}

/** The two ISO dates a slice is measured against, read from one clock. */
export interface DueWindow {
  /** Today, YYYY-MM-DD. */
  today: string
  /** Seven days from today, inclusive, YYYY-MM-DD. */
  weekEnd: string
}

/**
 * The window, from one reading of the clock.
 *
 * ⚠ ONE `new Date()`, READ TWICE. `Date.now()` trips `react-hooks/purity` at
 * the call site and mutating a local `Date` with `setDate` stops the React
 * Compiler preserving the memo that reads it — both surface as lint ERRORS, and
 * §9's baseline is deliberately frozen at 22 problems. §12: an exemption gets
 * named with its reason rather than absorbed by raising the number.
 */
export function dueWindowFrom(now: Date): DueWindow {
  return {
    today: now.toISOString().slice(0, 10),
    weekEnd: new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10),
  }
}

/**
 * Does this task fall in the chosen slice?
 *
 * ⚠ `undated` IS A FIRST-CLASS ANSWER, NOT THE ABSENCE OF ONE. It is the
 * largest group on the board, and the three date slices below must all REFUSE a
 * null rather than treating it as some default date — a task with no deadline
 * is not overdue and is not due this week, and counting it as either is how a
 * board tells its reader something false about their own week.
 */
export function matchesDue(
  dueDate: string | null,
  filter: DueFilter,
  window: DueWindow
): boolean {
  if (filter === 'all') return true
  if (filter === 'undated') return !dueDate
  if (!dueDate) return false
  if (filter === 'overdue') return dueDate < window.today
  return dueDate >= window.today && dueDate <= window.weekEnd
}
