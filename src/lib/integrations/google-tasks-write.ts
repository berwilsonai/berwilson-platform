/**
 * Read and write one team member's Google Tasks list.
 *
 * TWO INVARIANTS, both load-bearing enough to state before any code:
 *
 * 1. **Never enumerate a person's task lists at runtime.** The `tasks` scope is
 *    read + write + delete across EVERY list in the account — Google offers no
 *    app-created-only variant the way Drive does with `drive.file`. The only
 *    thing standing between this platform and somebody's private to-dos is that
 *    we address exactly one stored list id and never go looking. `listTaskLists`
 *    exists solely for the setup/verify path and must not be called by the sync.
 *
 * 2. **No `Date` constructor may touch a `due` value, in either direction.**
 *    Google's `due` is RFC 3339 but date-only in meaning: it returns Z-midnight
 *    and discards any time sent. Parsing one into a Date and reading it back in
 *    Mountain Time shifts it a day — the same class of bug the lead calendar had
 *    to learn. Read with `.slice(0, 10)`, write by string concatenation.
 *
 * Unlike the other write modules here, this one goes through `googleFetch`
 * rather than a hand-rolled `fetch`, so it inherits the retry/Retry-After
 * engine. Google throttles writes as readily as reads, and `tasks.insert` is
 * POST — see `isSafeToRepeat` in google-workspace.ts for why that distinction
 * had to move into the shared helper rather than be reinvented here.
 */

import {
  GoogleHttpError,
  googleFetch,
  type GoogleRequestInit,
} from '@/lib/integrations/google-workspace'

const TASKS_BASE = 'https://tasks.googleapis.com/tasks/v1'

/**
 * Google's alias for a person's DEFAULT task list — the one the Gmail sidebar's
 * ⊕, the phone app's +, and Assistant all write to.
 *
 * Syncing that list rather than a dedicated one is the whole reason capture
 * works: a task jotted anywhere in Google arrives here with no change of habit.
 * A dedicated list would mean selecting it every time, and forgetting once
 * means the task silently never syncs — the failure mode this codebase keeps
 * getting bitten by.
 *
 * It also preserves the invariant at the top of this file: addressing `@default`
 * is a single known list, not an enumeration of everything the person owns.
 * Anything they want kept private goes in a second list, which is never read.
 */
export const DEFAULT_LIST_ALIAS = '@default'

/** Google's cap is ~8,192 characters; leave room rather than lose the write. */
export const NOTES_LIMIT = 6_000

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The mailbox's stored consent predates the tasks scope. */
export class TasksScopeError extends Error {
  readonly mailbox: string

  constructor(mailbox: string) {
    super(
      `${mailbox} has not granted the tasks scope, so their task list cannot be synced. ` +
        `Add the address to GOOGLE_TASK_MAILBOXES, then re-consent with: ` +
        `node scripts/setup-google-oauth.mjs --only ${mailbox}`
    )
    this.name = 'TasksScopeError'
    this.mailbox = mailbox
  }
}

/**
 * The task is gone from Google.
 *
 * Note this is handled the OPPOSITE way to ContactGoneError, which triggers a
 * recreate. A member deleting a task from their own list is a decision, and
 * putting it back is the one behaviour this sync must never have. The caller
 * detaches instead.
 */
export class TaskGoneError extends Error {
  readonly googleTaskId: string

  constructor(googleTaskId: string) {
    super(`Google task ${googleTaskId} no longer exists.`)
    this.name = 'TaskGoneError'
    this.googleTaskId = googleTaskId
  }
}

/**
 * The whole list is gone.
 *
 * A list-level event, never to be read as N task-level deletions: the caller
 * pauses that member and detaches nothing. It also never recreates the list —
 * someone who deleted it is saying stop.
 */
export class TaskListGoneError extends Error {
  readonly googleListId: string

  constructor(googleListId: string) {
    super(`Google task list ${googleListId} no longer exists.`)
    this.name = 'TaskListGoneError'
    this.googleListId = googleListId
  }
}

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export interface GoogleTask {
  id: string
  title?: string
  notes?: string
  /** RFC 3339, date-only in meaning. See invariant 2. */
  due?: string
  status: 'needsAction' | 'completed'
  completed?: string | null
  updated?: string
  /** Set on a subtask. The platform has no subtask model, so these are skipped. */
  parent?: string
  position?: string
  /** Trashed. Only visible when the listing asks for showDeleted. */
  deleted?: boolean
  /** Completed in a first-party client. Invisible without showHidden. */
  hidden?: boolean
  webViewLink?: string
}

/** The fields this platform writes. Anything else Google holds is left alone. */
export interface TaskWrite {
  title: string
  notes: string
  due?: string
  status: 'needsAction' | 'completed'
  completed?: string | null
}

export interface GoogleTaskList {
  id: string
  title: string
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * One call, with Google's failure modes mapped onto this module's vocabulary.
 *
 * `kind` decides how a 404 reads: the same status means "that task is gone"
 * on a task URL and "that whole list is gone" on a list URL, and the two lead
 * to opposite actions.
 */
async function tasksCall<T>(
  mailbox: string,
  url: string,
  init: GoogleRequestInit,
  gone?: { kind: 'task'; id: string } | { kind: 'list'; id: string }
): Promise<T> {
  try {
    return await googleFetch<T>(url, mailbox, init)
  } catch (err) {
    if (err instanceof GoogleHttpError) {
      if (err.status === 404 && gone) {
        throw gone.kind === 'task'
          ? new TaskGoneError(gone.id)
          : new TaskListGoneError(gone.id)
      }
      // A 403 here is nearly always the missing scope rather than a real
      // denial, and Google renders the two identically.
      if (err.isScope) throw new TasksScopeError(mailbox)
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/**
 * Every list in the account.
 *
 * FOR SETUP AND VERIFICATION ONLY — see invariant 1. The sync addresses a
 * stored id and must never call this.
 */
export async function listTaskLists(mailbox: string): Promise<GoogleTaskList[]> {
  const res = await tasksCall<{ items?: GoogleTaskList[] }>(
    mailbox,
    `${TASKS_BASE}/users/@me/lists?maxResults=100`,
    {}
  )
  return res?.items ?? []
}

/**
 * Resolve a list, or confirm a stored one still exists.
 *
 * Null rather than throwing, because "gone" is a state the caller handles
 * rather than a failure. Pass {@link DEFAULT_LIST_ALIAS} to resolve the default
 * list to its real, stable id — which is what gets stored, so a later rename
 * does not look like a different list.
 */
export async function getTaskList(
  mailbox: string,
  listId: string
): Promise<GoogleTaskList | null> {
  try {
    return await tasksCall<GoogleTaskList>(
      mailbox,
      `${TASKS_BASE}/users/@me/lists/${encodeURIComponent(listId)}`,
      {},
      { kind: 'list', id: listId }
    )
  } catch (err) {
    if (err instanceof TaskListGoneError) return null
    throw err
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * Every task in one list, paged.
 *
 * ALL THREE show-flags are mandatory and the reason is not obvious:
 *
 *  - `showHidden` — a task completed in the Tasks app or the Gmail sidebar is
 *    marked hidden, and the DEFAULT listing omits it. Without this flag the
 *    single most common user action — ticking something off — makes the task
 *    vanish from our view, which the detach rule would read as a deletion. This
 *    flag is the difference between a working sync and one that quietly
 *    detaches every completed task.
 *  - `showCompleted` — defaults true, set explicitly so a future edit to this
 *    query cannot drop it silently.
 *  - `showDeleted` — a trashed task comes back with `deleted: true`, which is
 *    unambiguous evidence of removal. Far better than inferring deletion from
 *    absence, which needs a wall of guards to be safe.
 *
 * Returns `{ tasks, complete }`. `complete` is false when paging was cut short,
 * and the caller must not treat a partial listing as evidence of anything.
 */
export async function listTasks(
  mailbox: string,
  listId: string,
  opts: { maxPages?: number } = {}
): Promise<{ tasks: GoogleTask[]; complete: boolean }> {
  const maxPages = opts.maxPages ?? 20
  const out: GoogleTask[] = []
  let pageToken: string | undefined
  let complete = true

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      maxResults: '100',
      showCompleted: 'true',
      showHidden: 'true',
      showDeleted: 'true',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const res = await tasksCall<{ items?: GoogleTask[]; nextPageToken?: string }>(
      mailbox,
      `${TASKS_BASE}/lists/${encodeURIComponent(listId)}/tasks?${params}`,
      {},
      { kind: 'list', id: listId }
    )
    out.push(...(res?.items ?? []))
    pageToken = res?.nextPageToken
    if (!pageToken) return { tasks: out, complete }
  }

  // Ran out of pages with a token still in hand: we have seen part of the list.
  complete = false
  return { tasks: out, complete }
}

export async function insertTask(
  mailbox: string,
  listId: string,
  body: TaskWrite
): Promise<GoogleTask> {
  return tasksCall<GoogleTask>(
    mailbox,
    `${TASKS_BASE}/lists/${encodeURIComponent(listId)}/tasks`,
    { method: 'POST', body },
    { kind: 'list', id: listId }
  )
}

export async function patchTask(
  mailbox: string,
  listId: string,
  taskId: string,
  body: Partial<TaskWrite>
): Promise<GoogleTask> {
  return tasksCall<GoogleTask>(
    mailbox,
    `${TASKS_BASE}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'PATCH', body },
    { kind: 'task', id: taskId }
  )
}

/**
 * Clear a due date.
 *
 * Its own function because PATCH with `due: null` is widely reported not to
 * take on this API — the field is simply ignored rather than cleared. A full
 * PUT with `due` omitted does work, and is safe here only because this platform
 * owns every field it would send. Verified against the live API before use; if
 * PATCH ever starts honouring null, this can collapse back into patchTask.
 */
export async function clearTaskDue(
  mailbox: string,
  listId: string,
  taskId: string,
  body: TaskWrite
): Promise<GoogleTask> {
  const withoutDue: Omit<TaskWrite, 'due'> & { due?: string } = { ...body }
  delete withoutDue.due
  return tasksCall<GoogleTask>(
    mailbox,
    `${TASKS_BASE}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'PUT', body: { ...withoutDue, id: taskId } },
    { kind: 'task', id: taskId }
  )
}

/**
 * Remove a task from a member's list.
 *
 * Only ever called for a task the PLATFORM moved away — reassigned, unassigned
 * or deleted here. A task the member removed themselves is detached, not
 * deleted again. Already-gone is the outcome we wanted, so a 404 is swallowed.
 */
export async function deleteTask(
  mailbox: string,
  listId: string,
  taskId: string
): Promise<void> {
  try {
    await tasksCall<void>(
      mailbox,
      `${TASKS_BASE}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'DELETE' },
      { kind: 'task', id: taskId }
    )
  } catch (err) {
    if (err instanceof TaskGoneError) return
    throw err
  }
}
