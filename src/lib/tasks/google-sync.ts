/**
 * Reconcile the task board against each connected member's Google Tasks list.
 *
 * Structured on contacts/workspace-sync.ts — a deadline that breaks rather than
 * overruns, a `live` set that drops a member on their first scope failure, an
 * error list capped so one broken account cannot bury the rest, counters honest
 * enough to read as a report.
 *
 * WHAT IS AUTHORITATIVE WHERE
 *
 * Google owns exactly two fields: `status` and `due`. Everything else — title,
 * notes, and every record tag — is platform-owned and is corrected on the next
 * run if edited there. Anyone can see the reasoning: a member ticking a task
 * off on their phone is doing the thing this exists for, while a member
 * retitling one is drifting from the record two other people are reading.
 *
 * HOW THAT AVOIDS A LOOP
 *
 * Not by timestamps. Our own writeback bumps tasks.updated_at, and comparing a
 * microsecond timestamptz against Google's second-granularity `updated` loses
 * any edit landing inside the boundary — silently and permanently, which is the
 * worst failure this codebase has a name for. Instead each link stores the last
 * values BOTH SIDES AGREED ON (base_status, base_due) and the merge is
 * three-way, per field:
 *
 *      L=B, R=B  ->  nothing
 *      L=B, R≠B  ->  pull
 *      L≠B, R=B  ->  push
 *      L≠B, R≠B  ->  converged if equal, else Google wins and we say so
 *
 * The base is rewritten after every successful push or pull. Forgetting that is
 * the only way to reintroduce ping-pong. A STALE base costs one redundant
 * idempotent write; a stale cursor would cost a lost edit.
 *
 * Platform-owned fields are pushed only when the built value DIFFERS from what
 * Google holds. Not an unconditional overwrite: that would bump `updated` on
 * every task every run, render the member's whole list as just-changed, and
 * burn quota linearly with the size of the board.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/types'
import {
  TaskGoneError,
  TaskListGoneError,
  TasksScopeError,
  DEFAULT_LIST_ALIAS,
  clearTaskDue,
  deleteTask,
  getTaskList,
  insertTask,
  listTasks,
  patchTask,
  type GoogleTask,
  type TaskWrite,
} from '@/lib/integrations/google-tasks-write'
import {
  TASK_MAILBOXES,
  hasStoredCredential,
  isGoogleConfigured,
} from '@/lib/integrations/google-workspace'
import {
  buildTaskBody,
  parseDue,
  parseTaskIdFromNotes,
  stripFooter,
  type TaskBodyRow,
  type TaskTagContext,
} from '@/lib/tasks/google-body'

export interface TaskSyncResult {
  /** Active team members considered at all. */
  members: number
  /** Members with a credential AND a list. */
  connected: number
  /** Named, not merely counted: "who is not covered" is the whole question. */
  unconnected: string[]
  skippedMembers: string[]
  /** Members whose default list was resolved and remembered for the first time. */
  listsCreated: number
  pushedCreated: number
  pushedUpdated: number
  pushedDeleted: number
  unchanged: number
  pulledStatus: number
  pulledDue: number
  /** Both sides moved and disagreed; Google won and a note records it. */
  conflicts: number
  /** A remote task carrying our back-pointer whose link row we had lost. */
  relinked: number
  detached: number
  /** Links moved between two members' lists. */
  reassigned: number
  /** Tasks the member typed in Google that became real tasks here. */
  inboundCreated: number
  /** Remote tasks carrying our back-pointer that we could not re-adopt. */
  unlinkedRemote: number
  /** Subtasks and blank titles: nothing here can hold them, so they stay in Google. */
  skippedRemote: number
  /** Refusals: guard tripped, evidence insufficient. Reported, never obeyed. */
  heldBack: string[]
  failed: number
  errors: string[]
  outOfTime: boolean
  dryRun: boolean
}

export interface TaskSyncOptions {
  budgetMs?: number
  /** Point the whole reconcile at one member — the verification handle. */
  onlyMemberId?: string
  /** Do everything except write, on either side. Counters still populate. */
  dryRun?: boolean
}

interface MemberRow {
  id: string
  name: string
  email: string | null
  active: boolean
}

interface ListRow {
  team_member_id: string
  mailbox: string
  google_list_id: string
  missing_at: string | null
}

interface LinkRow {
  id: string
  task_id: string
  team_member_id: string
  google_list_id: string
  google_task_id: string
  state: string
  base_status: string | null
  base_due: string | null
  created_at: string | null
}

interface TaskRow extends TaskBodyRow {
  assignee_id: string | null
  project_id: string | null
  opportunity_id: string | null
  objective_id: string | null
  investor_id: string | null
}

const TASK_COLUMNS =
  'id, title, what, why, due_date, status, completed_at, assignee_id, project_id, opportunity_id, objective_id, investor_id'

/**
 * Most tasks a member can have in their Google list that did not come from here
 * before the run refuses to import any of them. Someone's personal list, or a
 * stored id pointing at the wrong list, would otherwise arrive on the board.
 */
const INBOUND_LIMIT = 20

/** Nothing younger than this is ever detached — see absenceIsEvidence(). */
const DETACH_MIN_AGE_MS = 60 * 60 * 1000

type Supabase = ReturnType<typeof createAdminClient>

// ---------------------------------------------------------------------------
// Tag names
// ---------------------------------------------------------------------------

/**
 * Resolve the record a task belongs to, to a NAME.
 *
 * Names rather than ids because the line is read by someone on a phone with no
 * way to look an id up, and frequently no way to reach the platform at all.
 * Cached for the whole run: a project with fifteen tasks on it costs one query.
 */
class TagNames {
  private readonly cache = new Map<string, string>()
  // Declared, not a constructor parameter property: this module is imported by
  // standalone verification scripts running under `node
  // --experimental-strip-types`, which is strip-only and cannot compile one.
  private readonly supabase: Supabase

  constructor(supabase: Supabase) {
    this.supabase = supabase
  }

  private async load(table: string, column: string, ids: string[]): Promise<void> {
    const missing = ids.filter((id) => !this.cache.has(`${table}:${id}`))
    if (missing.length === 0) return
    const { data } = await this.supabase
      .from(table as 'projects')
      .select(`id, ${column}`)
      .in('id', missing)
    for (const row of (data ?? []) as unknown as Record<string, string>[]) {
      if (row?.id) this.cache.set(`${table}:${row.id}`, String(row[column] ?? ''))
    }
  }

  async prime(tasks: TaskRow[]): Promise<void> {
    const pick = (f: keyof TaskRow) =>
      [...new Set(tasks.map((t) => t[f]).filter((v): v is string => Boolean(v)))]
    await Promise.all([
      this.load('projects', 'name', pick('project_id')),
      this.load('opportunities', 'name', pick('opportunity_id')),
      this.load('objectives', 'title', pick('objective_id')),
      this.load('investors', 'name', pick('investor_id')),
    ])
  }

  for(task: TaskRow): TaskTagContext {
    const get = (table: string, id: string | null) =>
      id ? (this.cache.get(`${table}:${id}`) ?? null) : null
    return {
      projectName: get('projects', task.project_id),
      opportunityName: get('opportunities', task.opportunity_id),
      objectiveTitle: get('objectives', task.objective_id),
      investorName: get('investors', task.investor_id),
    }
  }
}

// ---------------------------------------------------------------------------
// The merge
// ---------------------------------------------------------------------------

type Decision = 'none' | 'push' | 'pull' | 'converged'

/**
 * Three-way decision for one field.
 *
 * A null base means we have no record of ever agreeing — a link written by a
 * partial failure. The platform is the system of record, so push.
 */
export function decide<T>(local: T, remote: T, base: T | null | undefined): Decision {
  if (base === null || base === undefined) return local === remote ? 'none' : 'push'
  const localChanged = local !== base
  const remoteChanged = remote !== base
  if (!localChanged && !remoteChanged) return 'none'
  if (localChanged && remoteChanged) return local === remote ? 'converged' : 'pull'
  return remoteChanged ? 'pull' : 'push'
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncGoogleTasks(opts: TaskSyncOptions = {}): Promise<TaskSyncResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 10 * 60 * 1000)
  const dryRun = opts.dryRun ?? false
  const supabase = createAdminClient()
  const appUrl = (process.env.APP_URL ?? '').replace(/\/+$/, '')

  const result: TaskSyncResult = {
    members: 0,
    connected: 0,
    unconnected: [],
    skippedMembers: [],
    listsCreated: 0,
    pushedCreated: 0,
    pushedUpdated: 0,
    pushedDeleted: 0,
    unchanged: 0,
    pulledStatus: 0,
    pulledDue: 0,
    conflicts: 0,
    relinked: 0,
    detached: 0,
    reassigned: 0,
    inboundCreated: 0,
    unlinkedRemote: 0,
    skippedRemote: 0,
    heldBack: [],
    failed: 0,
    errors: [],
    outOfTime: false,
    dryRun,
  }

  if (!isGoogleConfigured()) {
    throw new Error('Google Workspace is not configured, so tasks cannot be synced.')
  }

  const noteFail = (msg: string) => {
    result.failed++
    if (result.errors.length < 10) result.errors.push(msg)
  }
  const hold = (msg: string) => {
    if (!result.heldBack.includes(msg)) result.heldBack.push(msg)
  }

  // --- who is in scope ------------------------------------------------------
  const { data: memberData, error: memberErr } = await supabase
    .from('team_members')
    .select('id, name, email, active')
    .eq('active', true)
  if (memberErr) throw new Error(memberErr.message)

  const allActive = (memberData ?? []) as MemberRow[]
  result.members = allActive.length

  // A member is in scope when their address is nominated AND a credential
  // exists for it. Anyone else is skipped in silence but named in `unconnected`
  // — most of the team is unconnected and that is the steady state, not a
  // fault, so it must be legible rather than alarming.
  const eligible = allActive.filter((m) => {
    const mailbox = m.email?.trim().toLowerCase()
    if (!mailbox || !TASK_MAILBOXES.includes(mailbox)) {
      result.unconnected.push(m.name)
      return false
    }
    if (!hasStoredCredential(mailbox)) {
      result.unconnected.push(`${m.name} (nominated, not yet consented)`)
      return false
    }
    return true
  })

  const scoped = opts.onlyMemberId
    ? eligible.filter((m) => m.id === opts.onlyMemberId)
    : eligible
  if (scoped.length === 0) return result

  const tags = new TagNames(supabase)

  // --- reassignment, detected by comparing state, never by a hook -----------
  // The bulk assignee update in api/team-members/[id] offers no per-row hook,
  // and three confirm routes create tasks without touching /api/tasks at all.
  // Only a state comparison sees all of it.
  //
  // Deliberately NOT narrowed by onlyMemberId: a scoped push most often follows
  // a reassignment, and the link that has to be cleaned up belongs to the OTHER
  // member — the one losing the task. Scoping this would leave their copy
  // sitting in their list until the next cron tick.
  await sweepReassigned(supabase, result, hold, dryRun)

  // --- per member -----------------------------------------------------------
  for (const member of scoped) {
    if (Date.now() > deadline) {
      result.outOfTime = true
      break
    }
    const mailbox = member.email!.trim().toLowerCase()

    try {
      const list = await ensureList(supabase, member, mailbox, result, dryRun)
      if (!list) continue
      result.connected++
      await syncMember(supabase, member, list, tags, appUrl, result, {
        deadline,
        dryRun,
        noteFail,
        hold,
      })
    } catch (err) {
      if (err instanceof TasksScopeError) {
        // Fails identically for every task in this member's list, so it is one
        // line about the member rather than one per task.
        result.skippedMembers.push(`${member.name}: tasks scope not granted`)
        continue
      }
      if (err instanceof TaskListGoneError) {
        // A LIST-level event. Pause the member, detach nothing, and never
        // recreate: someone who deleted the whole list is saying stop, and
        // rebuilding it and re-pushing everything is the maximal version of the
        // resurrection this design forbids.
        if (!dryRun) {
          await supabase
            .from('google_task_lists')
            .update({ missing_at: new Date().toISOString(), last_error: 'List deleted in Google' })
            .eq('team_member_id', member.id)
        }
        hold(`${member.name}: their Google list was deleted — sync paused, nothing detached`)
        continue
      }
      noteFail(`${member.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  result.unconnected = [...new Set(result.unconnected)]
  result.skippedMembers = [...new Set(result.skippedMembers)]
  return result
}

/**
 * Resolve the member's default Google list, remembering its real id.
 *
 * We do NOT create a list. Syncing the default one is what makes capture work:
 * everything Google writes by default — the Gmail sidebar, the phone app,
 * Assistant — lands there, so a task jotted anywhere arrives without anyone
 * changing how they work. A dedicated list would have to be selected every
 * time, and forgetting once loses the task silently.
 *
 * The alias is resolved to the real id on first sight and stored, so renaming
 * the list does not read as a different list. Anything the member wants kept
 * out of the CRM goes in a SECOND list, which is never read.
 */
async function ensureList(
  supabase: Supabase,
  member: MemberRow,
  mailbox: string,
  result: TaskSyncResult,
  dryRun: boolean
): Promise<ListRow | null> {
  const { data } = await supabase
    .from('google_task_lists')
    .select('team_member_id, mailbox, google_list_id, missing_at')
    .eq('team_member_id', member.id)
    .maybeSingle()

  const row = data as ListRow | null

  if (row?.missing_at) {
    result.heldBack.push(
      `${member.name}: sync paused (their list was deleted); clear missing_at to resume`
    )
    return null
  }

  if (row) {
    // Confirm it is still there. A 404 is the list-level event the caller
    // handles, and must never be read as "all their tasks were deleted".
    const remote = await getTaskList(mailbox, row.google_list_id)
    if (!remote) throw new TaskListGoneError(row.google_list_id)
    return row
  }

  // First sight: resolve @default to the stable id behind it.
  const resolved = await getTaskList(mailbox, DEFAULT_LIST_ALIAS)
  if (!resolved) throw new TaskListGoneError(DEFAULT_LIST_ALIAS)

  if (dryRun) {
    result.listsCreated++
    return null
  }

  const { error } = await supabase.from('google_task_lists').insert({
    team_member_id: member.id,
    mailbox,
    google_list_id: resolved.id,
    title: resolved.title ?? 'My Tasks',
  })
  if (error) throw new Error(`could not record the list: ${error.message}`)
  result.listsCreated++
  return {
    team_member_id: member.id,
    mailbox,
    google_list_id: resolved.id,
    missing_at: null,
  }
}

/**
 * Move links whose task no longer belongs to the member holding them.
 *
 * Two steps, deliberately separated: mark orphaned, then delete remotely. The
 * `orphaned` state IS the retry queue — a delete that fails because that
 * member's token is momentarily broken must be tried again, not lost, or the
 * task lives on in their list forever with a link to nothing.
 */
async function sweepReassigned(
  supabase: Supabase,
  result: TaskSyncResult,
  hold: (msg: string) => void,
  dryRun: boolean
): Promise<void> {
  const { data: linkData } = await supabase
    .from('task_google_links')
    .select('id, task_id, team_member_id, google_list_id, google_task_id, state, base_status, base_due, created_at')
    .in('state', ['active', 'orphaned'])
  const links = (linkData ?? []) as LinkRow[]
  if (links.length === 0) return

  const active = links.filter((l) => l.state === 'active')
  const taskIds = [...new Set(active.map((l) => l.task_id))]
  const assignee = new Map<string, string | null>()
  for (let i = 0; i < taskIds.length; i += 200) {
    const { data } = await supabase
      .from('tasks')
      .select('id, assignee_id')
      .in('id', taskIds.slice(i, i + 200))
    for (const t of data ?? []) assignee.set(t.id, t.assignee_id)
  }

  const moved = active.filter((l) => assignee.get(l.task_id) !== l.team_member_id)

  // Majority guard, at LINK level and not just list level. tasks.assignee_id is
  // ON DELETE SET NULL, so hard-deleting a team member nulls every one of their
  // tasks at once — and without this the very next run would try to empty that
  // person's entire Google list in a single pass.
  const byMember = new Map<string, { moved: number; total: number }>()
  for (const l of active) {
    const e = byMember.get(l.team_member_id) ?? { moved: 0, total: 0 }
    e.total++
    byMember.set(l.team_member_id, e)
  }
  for (const l of moved) {
    const e = byMember.get(l.team_member_id)
    if (e) e.moved++
  }
  const refused = new Set<string>()
  for (const [memberId, e] of byMember) {
    if (e.moved > 1 && e.moved > e.total / 2) {
      refused.add(memberId)
      hold(
        `refused to move ${e.moved} of ${e.total} tasks out of one member's list in a single run — ` +
          `that is a member-level event, not ${e.moved} filing decisions`
      )
    }
  }

  const toOrphan = moved.filter((l) => !refused.has(l.team_member_id))
  if (!dryRun && toOrphan.length > 0) {
    await supabase
      .from('task_google_links')
      .update({ state: 'orphaned' })
      .in('id', toOrphan.map((l) => l.id))
  }

  // Drain the queue: everything already orphaned plus what we just marked.
  const pending = [
    ...links.filter((l) => l.state === 'orphaned'),
    ...(dryRun ? [] : toOrphan),
  ]
  const mailboxes = await listMailboxes(supabase)

  for (const link of pending) {
    const mailbox = mailboxes.get(link.team_member_id)
    if (!mailbox) {
      // The member is gone entirely; the row would otherwise be retried forever.
      if (!dryRun) await supabase.from('task_google_links').delete().eq('id', link.id)
      continue
    }
    if (dryRun) {
      result.pushedDeleted++
      continue
    }
    try {
      await deleteTask(mailbox, link.google_list_id, link.google_task_id)
      await supabase.from('task_google_links').delete().eq('id', link.id)
      result.pushedDeleted++
      if (toOrphan.some((l) => l.id === link.id)) result.reassigned++
    } catch (err) {
      if (err instanceof TasksScopeError || err instanceof TaskListGoneError) {
        // Leave the row orphaned; the next run retries it.
        continue
      }
      throw err
    }
  }
}

async function listMailboxes(supabase: Supabase): Promise<Map<string, string>> {
  const { data } = await supabase.from('google_task_lists').select('team_member_id, mailbox')
  return new Map((data ?? []).map((r) => [r.team_member_id, r.mailbox]))
}

interface MemberCtx {
  deadline: number
  dryRun: boolean
  noteFail: (msg: string) => void
  hold: (msg: string) => void
}

async function syncMember(
  supabase: Supabase,
  member: MemberRow,
  list: ListRow,
  tags: TagNames,
  appUrl: string,
  result: TaskSyncResult,
  ctx: MemberCtx
): Promise<void> {
  const { tasks: remoteTasks, complete } = await listTasks(list.mailbox, list.google_list_id)
  const remoteById = new Map(remoteTasks.map((t) => [t.id, t]))

  const { data: linkData } = await supabase
    .from('task_google_links')
    .select('id, task_id, team_member_id, google_list_id, google_task_id, state, base_status, base_due, created_at')
    .eq('team_member_id', member.id)
    .in('state', ['active', 'detached'])
  const links = (linkData ?? []) as LinkRow[]
  const activeByTask = new Map(links.filter((l) => l.state === 'active').map((l) => [l.task_id, l]))
  const detachedTasks = new Set(links.filter((l) => l.state === 'detached').map((l) => l.task_id))

  // Whether absence may be read as deletion is a judgement about this listing
  // as a whole, so it is made once here rather than re-argued for each task.
  // A tombstone (deleted: true) is separate: that one is unambiguous.
  const activeLinks = links.filter((l) => l.state === 'active')
  const trulyAbsent = activeLinks.filter((l) => !remoteById.has(l.google_task_id))
  const mayDetachAbsent = absenceIsEvidence(
    member,
    trulyAbsent,
    activeLinks,
    complete,
    remoteTasks.length,
    result.outOfTime,
    ctx.hold
  )

  // Open tasks always; done tasks only once they already have a link, so a
  // member's first sync does not back-fill years of finished work into their
  // phone. Completion still propagates, which is the point.
  const { data: openData } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('assignee_id', member.id)
    .eq('status', 'open')
  const linkedIds = [...activeByTask.keys()]
  const { data: linkedData } = linkedIds.length
    ? await supabase.from('tasks').select(TASK_COLUMNS).in('id', linkedIds)
    : { data: [] }

  const byId = new Map<string, TaskRow>()
  for (const t of [...(openData ?? []), ...(linkedData ?? [])] as TaskRow[]) byId.set(t.id, t)
  const tasks = [...byId.values()]
  await tags.prime(tasks)

  // --- remote tasks with no link row -------------------------------------
  // Two very different things look identical here, and telling them apart is
  // what stops the board filling with duplicates:
  //
  //  1. One of OURS whose link row we lost — to a crash, or to an insert whose
  //     response never arrived. It carries our back-pointer in its notes, so it
  //     is re-adopted. Without this the task would be pushed again and the
  //     member would end up holding two copies of it.
  //  2. Something the member actually typed into Google. That becomes a real
  //     task on the board, which is the point of syncing their default list.
  const claimed = new Set([...activeByTask.values()].map((l) => l.google_task_id))
  const fresh: GoogleTask[] = []

  for (const remote of remoteTasks) {
    if (remote.deleted || claimed.has(remote.id)) continue

    const taskId = parseTaskIdFromNotes(remote.notes)
    if (taskId) {
      const task = byId.get(taskId)
      if (!task || activeByTask.has(taskId) || detachedTasks.has(taskId)) {
        result.unlinkedRemote++
        continue
      }
      if (ctx.dryRun) {
        result.relinked++
        continue
      }
      const { data: relinked } = await supabase
        .from('task_google_links')
        .insert({
          task_id: taskId,
          team_member_id: member.id,
          google_list_id: list.google_list_id,
          google_task_id: remote.id,
          base_status: remote.status === 'completed' ? 'done' : 'open',
          base_due: parseDue(remote.due),
        })
        .select('id, task_id, team_member_id, google_list_id, google_task_id, state, base_status, base_due, created_at')
        .maybeSingle()
      if (relinked) {
        activeByTask.set(taskId, relinked as LinkRow)
        claimed.add(remote.id)
        result.relinked++
      }
      continue
    }

    // A subtask has no equivalent here and flattening it would lose the thing
    // that made it a subtask. A blank title is something Google permits and
    // tasks.title does not. Both are left alone in Google, never deleted.
    if (remote.parent) {
      result.skippedRemote++
      continue
    }
    if (!remote.title?.trim()) {
      result.skippedRemote++
      continue
    }
    fresh.push(remote)
  }

  // Importing a person's whole list in one go is almost never what happened —
  // far more likely their default list is full of their own life, or the stored
  // id now points somewhere else. Report it and import nothing rather than put
  // dozens of rows in front of the whole team.
  if (fresh.length > INBOUND_LIMIT) {
    ctx.hold(
      `${member.name}: ${fresh.length} tasks in their Google list are not from here — ` +
        `refusing to import that many at once. Check the list is theirs, then raise INBOUND_LIMIT to let it through.`
    )
  } else {
    for (const remote of fresh) {
      if (Date.now() > ctx.deadline) {
        result.outOfTime = true
        break
      }
      if (ctx.dryRun) {
        result.inboundCreated++
        continue
      }
      try {
        await importRemoteTask(supabase, member, list, remote, appUrl, result)
      } catch (err) {
        ctx.noteFail(
          `${member.name} / importing "${remote.title}": ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  for (const task of tasks) {
    if (Date.now() > ctx.deadline) {
      result.outOfTime = true
      return
    }
    // The latch. A member deleting a task from their own list was a decision,
    // and putting it back is the one thing this sync must never do.
    if (detachedTasks.has(task.id)) continue

    const body = buildTaskBody(task, tags.for(task), appUrl)
    const link = activeByTask.get(task.id)

    try {
      if (!link) {
        await createRemote(supabase, member, list, task, body, result, ctx)
        continue
      }
      const remote = remoteById.get(link.google_task_id)
      if (remote?.deleted) {
        await detach(supabase, task, link, 'Deleted in Google', result, ctx)
        continue
      }
      if (!remote) {
        // Trashed long enough ago that Google purged the tombstone. Only acted
        // on when the listing as a whole was trustworthy, and never for a link
        // young enough that a lost insert response would look identical.
        const age = Date.now() - new Date(link.created_at ?? 0).getTime()
        if (mayDetachAbsent && age >= DETACH_MIN_AGE_MS) {
          await detach(supabase, task, link, 'No longer in the Google list', result, ctx)
        }
        continue
      }
      await mergeOne(supabase, list, task, body, link, remote, result, ctx)
    } catch (err) {
      if (err instanceof TaskGoneError) {
        // The strongest possible evidence of removal, and it arrives as the
        // answer to a write. Detach — never recreate, which is what the
        // equivalent contacts path does and would be wrong here.
        await detach(supabase, task, link ?? null, 'Deleted in Google', result, ctx)
        continue
      }
      if (err instanceof TasksScopeError || err instanceof TaskListGoneError) throw err
      ctx.noteFail(`${member.name} / ${task.title}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function createRemote(
  supabase: Supabase,
  member: MemberRow,
  list: ListRow,
  task: TaskRow,
  body: TaskWrite,
  result: TaskSyncResult,
  ctx: MemberCtx
): Promise<void> {
  if (ctx.dryRun) {
    result.pushedCreated++
    return
  }
  const created = await insertTask(list.mailbox, list.google_list_id, body)
  const { error } = await supabase.from('task_google_links').insert({
    task_id: task.id,
    team_member_id: member.id,
    google_list_id: list.google_list_id,
    google_task_id: created.id,
    // Seeded from what we just pushed: both sides now agree, so the next run
    // sees no change on either side rather than pushing all over again.
    base_status: task.status === 'done' ? 'done' : 'open',
    base_due: task.due_date,
    last_synced_at: new Date().toISOString(),
  })
  if (error) {
    // The link failed but the remote task exists. Remove it rather than leave
    // an unowned task in someone's list that the next run would duplicate.
    await deleteTask(list.mailbox, list.google_list_id, created.id).catch(() => {})
    throw new Error(`could not record the link: ${error.message}`)
  }
  result.pushedCreated++
}

/**
 * Turn a task the member typed in Google into a real task on the board.
 *
 * Every record tag is left NULL, deliberately. Nothing in "call the surety
 * broker" says which project it belongs to, and a guess would be invisible:
 * an untagged task is visibly unfiled and someone fixes it in a second, while
 * a wrongly-filed one looks correct and quietly distorts a project's picture.
 *
 * The shadow is seeded from what Google already holds, so the merge in the same
 * run sees no change on either side and does not immediately push back. The one
 * write that does follow is the notes footer, which arms the back-pointer that
 * lets this task be re-adopted rather than duplicated if its link is ever lost.
 */
async function importRemoteTask(
  supabase: Supabase,
  member: MemberRow,
  list: ListRow,
  remote: GoogleTask,
  appUrl: string,
  result: TaskSyncResult
): Promise<void> {
  const done = remote.status === 'completed'
  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      title: remote.title!.trim(),
      // Their own notes become the detail, minus any footer of ours.
      what: stripFooter(remote.notes),
      assignee_id: member.id,
      due_date: parseDue(remote.due),
      status: done ? 'done' : 'open',
      completed_at: done ? (remote.completed ?? new Date().toISOString()) : null,
    })
    .select(TASK_COLUMNS)
    .single()
  if (error || !task) throw new Error(error?.message ?? 'insert returned nothing')

  const { error: linkErr } = await supabase.from('task_google_links').insert({
    task_id: task.id,
    team_member_id: member.id,
    google_list_id: list.google_list_id,
    google_task_id: remote.id,
    origin: 'google',
    base_status: done ? 'done' : 'open',
    base_due: parseDue(remote.due),
    last_synced_at: new Date().toISOString(),
  })
  if (linkErr) {
    // Without a link this task would be imported again on the next run, and
    // again after that. Undo rather than leave a duplicate generator behind.
    await supabase.from('tasks').delete().eq('id', task.id)
    throw new Error(`could not record the link: ${linkErr.message}`)
  }

  // Stamp the back-pointer so a future lost link is recovered, not duplicated.
  const body = buildTaskBody(task as TaskRow, {}, appUrl)
  if (body.notes !== (remote.notes ?? '')) {
    await patchTask(list.mailbox, list.google_list_id, remote.id, { notes: body.notes })
  }

  result.inboundCreated++
}

/** The three-way merge for one task, plus the platform-owned overwrite. */
async function mergeOne(
  supabase: Supabase,
  list: ListRow,
  task: TaskRow,
  body: TaskWrite,
  link: LinkRow,
  remote: GoogleTask,
  result: TaskSyncResult,
  ctx: MemberCtx
): Promise<void> {
  const localStatus = task.status === 'done' ? 'done' : 'open'
  const remoteStatus = remote.status === 'completed' ? 'done' : 'open'
  const localDue = task.due_date ?? null
  const remoteDue = parseDue(remote.due)

  const statusCall = decide(localStatus, remoteStatus, link.base_status)
  const dueCall = decide(localDue, remoteDue, link.base_due)

  const googlePatch: Partial<TaskWrite> = {}
  const platformPatch: TablesUpdate<'tasks'> = {}
  let clearDue = false

  if (statusCall === 'push') {
    googlePatch.status = body.status
    if (body.completed) googlePatch.completed = body.completed
  } else if (statusCall === 'pull') {
    platformPatch.status = remoteStatus
    platformPatch.completed_at =
      remoteStatus === 'done' ? (remote.completed ?? new Date().toISOString()) : null
    result.pulledStatus++
    if (localStatus !== link.base_status) result.conflicts++
  }

  if (dueCall === 'push') {
    if (localDue) googlePatch.due = `${localDue}T00:00:00.000Z`
    else clearDue = true
  } else if (dueCall === 'pull') {
    platformPatch.due_date = remoteDue
    result.pulledDue++
    if (localDue !== link.base_due) result.conflicts++
  }

  // Platform-owned fields: corrected only when they actually differ.
  if ((remote.title ?? '') !== body.title) googlePatch.title = body.title
  if ((remote.notes ?? '') !== body.notes) googlePatch.notes = body.notes

  const touchesGoogle = Object.keys(googlePatch).length > 0 || clearDue
  const touchesPlatform = Object.keys(platformPatch).length > 0
  const baseMoved =
    link.base_status !== (statusCall === 'pull' ? remoteStatus : localStatus) ||
    link.base_due !== (dueCall === 'pull' ? remoteDue : localDue)

  if (!touchesGoogle && !touchesPlatform && !baseMoved) {
    result.unchanged++
    return
  }

  if (ctx.dryRun) {
    if (touchesGoogle) result.pushedUpdated++
    return
  }

  if (clearDue) {
    // PATCH with due:null is not honoured by this API; a full PUT is.
    await clearTaskDue(list.mailbox, list.google_list_id, link.google_task_id, {
      ...body,
      ...(googlePatch.status ? { status: googlePatch.status } : {}),
    })
    result.pushedUpdated++
  } else if (touchesGoogle) {
    await patchTask(list.mailbox, list.google_list_id, link.google_task_id, googlePatch)
    result.pushedUpdated++
  }

  if (touchesPlatform) {
    await supabase.from('tasks').update(platformPatch).eq('id', task.id)
  }

  if (statusCall === 'pull' && localStatus !== link.base_status) {
    await supabase.from('task_notes').insert({
      task_id: task.id,
      body:
        `Google Tasks and Ber Intelligence disagreed about this task. Google said ` +
        `"${remoteStatus}", here it was "${localStatus}" — Google wins, so it is now "${remoteStatus}".`,
      author: 'Google Tasks sync',
    })
  }

  // Rewrite the base to whatever both sides now hold. Skipping this is the only
  // way to reintroduce a loop.
  await supabase
    .from('task_google_links')
    .update({
      base_status: statusCall === 'pull' ? remoteStatus : localStatus,
      base_due: dueCall === 'pull' ? remoteDue : localDue,
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', link.id)
}

/**
 * May absence from the listing be treated as deletion, for this member, now?
 *
 * Decided ONCE per member rather than per task, because every reason to refuse
 * is a statement about the listing as a whole. `deleted: true` is unambiguous
 * and bypasses all of this; absence is the weak signal, and obeying a bad one
 * silently unhooks someone's entire list.
 */
function absenceIsEvidence(
  member: MemberRow,
  absent: LinkRow[],
  activeLinks: LinkRow[],
  listingComplete: boolean,
  listedCount: number,
  outOfTime: boolean,
  hold: (msg: string) => void
): boolean {
  if (absent.length === 0) return false

  // 1. A partial listing proves nothing about what it did not reach.
  if (!listingComplete) {
    hold(`${member.name}: listing was incomplete, so nothing was detached`)
    return false
  }
  // 2. An empty listing is never evidence.
  if (listedCount === 0) {
    hold(
      `${member.name}: their list came back empty — refusing to detach ${activeLinks.length} task(s)`
    )
    return false
  }
  // 3. A run that ran out of time saw an arbitrary slice of the world.
  if (outOfTime) return false
  // 4. Losing more than half at once is a list-level event — a renamed,
  //    re-permissioned or repointed list — and is reported, not obeyed. The
  //    `> 1` clause matters: one missing task out of one is a filing decision,
  //    and must stay actionable or the gesture silently never works.
  if (absent.length > 1 && absent.length > activeLinks.length / 2) {
    hold(
      `${member.name}: ${absent.length} of ${activeLinks.length} linked tasks vanished at once — ` +
        `refusing to detach them`
    )
    return false
  }
  return true
}

async function detach(
  supabase: Supabase,
  task: TaskRow,
  link: LinkRow | null,
  reason: string,
  result: TaskSyncResult,
  ctx: MemberCtx
): Promise<void> {
  result.detached++
  if (ctx.dryRun || !link) return

  await supabase
    .from('task_google_links')
    .update({
      state: 'detached',
      detached_at: new Date().toISOString(),
      detach_reason: reason,
    })
    .eq('id', link.id)

  // Put it where a human will actually see it. task_notes carries no activity
  // trigger, so this costs nothing and lands in the task's own feed.
  await supabase.from('task_notes').insert({
    task_id: task.id,
    body: `${reason}. Still open here; it is no longer syncing to Google Tasks.`,
    author: 'Google Tasks sync',
  })

  // NEVER touches status, completed_at or assignee_id. Removing something from
  // your list is not the same as finishing it, and this sync does not get to
  // decide that it is.
}
