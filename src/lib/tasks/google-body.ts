/**
 * Build what a platform task looks like as a Google task, and read one back.
 *
 * THE INVARIANT: {@link buildTaskBody} must be a pure function of stable
 * columns. The sync pushes a platform-owned field only when the built value
 * differs from what Google currently holds, so a single volatile value in here
 * — a computed "as of", a relative date, anything derived from the clock —
 * would make every task differ on every run. That is not merely wasteful: it
 * bumps Google's `updated` on everything, shows the member's whole list as
 * just-changed, and burns quota linearly with the size of the board.
 *
 * And the second rule from google-tasks-write.ts, restated because this is
 * where it would be broken: `due` is built by string concatenation from a
 * `date` column. No `Date` constructor touches it.
 */

import { NOTES_LIMIT, type TaskWrite } from '@/lib/integrations/google-tasks-write'

/** The one line that carries a task's id back out of Google. */
const LINK_PREFIX = 'Open in Ber Intelligence: '

export interface TaskBodyRow {
  id: string
  title: string
  what: string | null
  why: string | null
  due_date: string | null
  status: string
  completed_at: string | null
}

/**
 * The record a task belongs to, already resolved to a name.
 *
 * Names rather than ids because this line is read by someone on a phone who has
 * no way to look an id up — and often no way to reach the platform at all.
 */
export interface TaskTagContext {
  projectName?: string | null
  opportunityName?: string | null
  objectiveTitle?: string | null
  investorName?: string | null
}

function tagLine(tags: TaskTagContext): string | null {
  if (tags.projectName) return `Project: ${tags.projectName}`
  if (tags.opportunityName) return `Opportunity: ${tags.opportunityName}`
  if (tags.investorName) return `Investor: ${tags.investorName}`
  if (tags.objectiveTitle) return `Objective: ${tags.objectiveTitle}`
  return null
}

/**
 * Assemble the notes body.
 *
 * Order is deliberate: `what` (the concrete thing to do) leads, `why` follows,
 * then the record it belongs to, then the deep link LAST. The tag line has to
 * stand on its own above the link because the link is a tailnet URL — dead on a
 * phone off the network, which is precisely the reader this exists for.
 */
export function buildNotes(task: TaskBodyRow, tags: TaskTagContext, appUrl: string): string {
  const parts: string[] = []

  const what = task.what?.trim()
  const why = task.why?.trim()
  if (what) parts.push(what)
  if (why) parts.push(what ? `Why: ${why}` : why)

  const tag = tagLine(tags)
  if (tag) parts.push(tag)

  const base = appUrl.replace(/\/+$/, '')
  if (base) parts.push(`${LINK_PREFIX}${base}/tasks?task=${task.id}`)

  const body = parts.join('\n\n')
  if (body.length <= NOTES_LIMIT) return body

  // Truncate the prose, never the link — losing the link would break the
  // back-pointer that lets a lost link row be recovered instead of duplicated.
  const link = base ? `\n\n${LINK_PREFIX}${base}/tasks?task=${task.id}` : ''
  return body.slice(0, Math.max(0, NOTES_LIMIT - link.length - 1)).trimEnd() + '…' + link
}

/**
 * A platform task as Google should hold it.
 *
 * `title` falls back rather than being allowed through empty: Google accepts a
 * blank title and renders an unreadable row, and `tasks.title` is NOT NULL here
 * anyway, so an empty one means the row was written by something that bypassed
 * the API.
 */
export function buildTaskBody(
  task: TaskBodyRow,
  tags: TaskTagContext,
  appUrl: string
): TaskWrite {
  const done = task.status === 'done'
  return {
    title: task.title?.trim() || 'Untitled task',
    notes: buildNotes(task, tags, appUrl),
    // String concatenation, never a Date — see the module docstring.
    ...(task.due_date ? { due: `${task.due_date}T00:00:00.000Z` } : {}),
    status: done ? 'completed' : 'needsAction',
    ...(done && task.completed_at ? { completed: task.completed_at } : {}),
  }
}

/**
 * Read Google's `due` back as a plain date.
 *
 * `.slice(0, 10)` is correct here specifically BECAUSE Google normalises to
 * Z-midnight; it is not a general way to get a date out of a timestamp.
 */
export function parseDue(due: string | undefined): string | null {
  if (!due) return null
  const day = due.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

/**
 * Recover a platform task id from a Google task's notes.
 *
 * This is the back-pointer that makes inbound import safe: a task in the list
 * that carries one is not something new the member wrote, it is one of ours
 * whose link row we lost — to a crash, or to an insert whose response never
 * arrived. Without this check the next run would import it as a second copy of
 * a task already on the board. It plays exactly the role
 * `userDefined: [{ key: 'Ber Intelligence ID' }]` plays on a synced contact.
 */
export function parseTaskIdFromNotes(notes: string | undefined): string | null {
  if (!notes) return null
  const m = notes.match(
    /[?&]task=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  )
  return m ? m[1].toLowerCase() : null
}

/**
 * Strip our own footer from notes a member is about to have imported.
 *
 * Only relevant on the recovery path, where the notes were written by us; a
 * genuinely new task the member typed has no footer and is unaffected.
 */
export function stripFooter(notes: string | undefined): string | null {
  if (!notes) return null
  const cleaned = notes
    .split('\n')
    .filter((line) => !line.startsWith(LINK_PREFIX))
    .join('\n')
    .trim()
  return cleaned || null
}
