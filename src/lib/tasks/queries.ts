/**
 * Shared task queries — the `tasks` table is the single source of truth for
 * action items across attention, calendar, briefs, and the agent.
 * (Replaces the legacy `updates.action_items` JSON reads, removed 2026-07-02.)
 */

import { dropHidden, hiddenProjectIds } from '@/lib/security/confidential'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface TaskSummary {
  id: string
  title: string
  assignee: string | null
  project_id: string | null
  project_name: string | null
  due_date: string | null
  created_at: string | null
}

export interface FetchOpenTasksOptions {
  projectId?: string
  projectIds?: string[]
  /** Tasks tagged to one opportunity (tasks.opportunity_id). */
  opportunityId?: string
  /** Inclusive ISO date bounds on due_date; setting either implies requireDueDate. */
  dueBefore?: string
  dueAfter?: string
  requireDueDate?: boolean
  limit?: number
}

/**
 * Fetch open tasks with assignee + project names resolved.
 * Name resolution uses separate lookups (no PostgREST embeds) so it stays
 * dual-schema tolerant.
 */
export async function fetchOpenTasks(
  supabase: AdminClient,
  opts: FetchOpenTasksOptions = {}
): Promise<TaskSummary[]> {
  let q = supabase
    .from('tasks')
    .select('id, title, assignee_id, project_id, due_date, created_at')
    .eq('status', 'open')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(opts.limit ?? 200)

  if (opts.projectId) q = q.eq('project_id', opts.projectId)
  if (opts.projectIds && opts.projectIds.length > 0) q = q.in('project_id', opts.projectIds)
  if (opts.opportunityId) q = q.eq('opportunity_id', opts.opportunityId)
  if (opts.dueBefore) q = q.lte('due_date', opts.dueBefore)
  if (opts.dueAfter) q = q.gte('due_date', opts.dueAfter)
  if (opts.requireDueDate || opts.dueBefore || opts.dueAfter) q = q.not('due_date', 'is', null)

  const { data: tasks, error } = await q
  if (error || !tasks || tasks.length === 0) return []

  // ── Protected projects ──────────────────────────────────────────────────────
  //
  // An UNSCOPED read is a portfolio read — the dashboard, the weekly brief, the
  // agent's search_tasks — and never sees a confidential project's tasks. A read
  // explicitly scoped to a project (projectId/projectIds) is left alone, because
  // the caller has already been through that project's own gate: the project
  // page and its tabs are behind the middleware rewrite.
  //
  // ⚠ That exemption is only true for callers that ARE gated. A route taking a
  // project id in its BODY is not reached by the middleware, so it must call
  // requireProjectAccess() itself — see src/lib/security/guard.ts.
  const scopedToProjects = !!opts.projectId || (opts.projectIds?.length ?? 0) > 0
  const visibleTasks = scopedToProjects
    ? tasks
    : dropHidden(tasks, (t) => t.project_id, await hiddenProjectIds(null))
  if (visibleTasks.length === 0) return []

  const projectIds = [...new Set(visibleTasks.map((t) => t.project_id).filter(Boolean))] as string[]

  const [{ data: members }, { data: projects }] = await Promise.all([
    supabase.from('team_members').select('id, name'),
    projectIds.length > 0
      ? supabase.from('projects').select('id, name').in('id', projectIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])

  const memberName = new Map((members ?? []).map((m) => [m.id, m.name]))
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]))

  return visibleTasks.map((t) => ({
    id: t.id,
    title: t.title,
    assignee: t.assignee_id ? memberName.get(t.assignee_id) ?? null : null,
    project_id: t.project_id,
    project_name: t.project_id ? projectName.get(t.project_id) ?? null : null,
    due_date: t.due_date,
    created_at: t.created_at,
  }))
}

export interface DigestTask {
  id: string
  title: string
  why: string | null
  due_date: string | null
  assignee_id: string | null
  project_name: string | null
  opportunity_name: string | null
  /** For tiering — see lib/tasks/priority.ts. */
  project_id: string | null
  opportunity_id: string | null
  commitment_id: string | null
}

/**
 * Fetch the open, owned tasks the per-member note lists.
 *
 * Kept separate from `fetchOpenTasks`/`TaskSummary` (shared by the AI briefs)
 * because the note needs `assignee_id` + `why` and groups by person. Name
 * resolution uses separate lookups (no PostgREST embeds) for dual-schema safety.
 *
 * ⚠ A DUE DATE IS NO LONGER REQUIRED, AND REQUIRING IT WOULD HAVE SILENCED THE
 * WHOLE POINT OF PROMOTING OBLIGATIONS ONTO THE BOARD. This read used to filter
 * `due_date is not null`, and the note then bucketed what came back into overdue
 * and due-in-7 — so an undated task reached neither bucket and was never
 * mentioned. Of the 38 live internal commitments promoted on 2026-10-12, **34
 * carry no due date**: Eric does not put a deadline on "Finalize the Fairbanks
 * Mining Contract", he just says it is outstanding. The morning note would have
 * listed none of them while all 38 sat on the board.
 *
 * A deadline is attached to the work LEAST likely to matter here — a bid
 * invitation always has one and a real obligation usually does not — which is
 * the same asymmetry that made the board's date-first sort unreadable. The note
 * decides what to say about an undated task; this just stops hiding it.
 */
export async function fetchTasksForDigest(
  supabase: AdminClient,
  opts: {
    /**
     * Include tasks nobody owns.
     *
     * ⚠ OFF BY DEFAULT, AND THE DEFAULT IS THE OLD BEHAVIOUR ON PURPOSE. Every
     * existing caller groups by person, so an unowned row would reach nobody's
     * section and be silently dropped — §12: never fork a shared pass, add a
     * target. The target is the weekly task reminder, which is the one reader
     * that can honestly say "nobody is on this".
     *
     * ⚠ MEASURED 2026-10-21, WHICH IS WHY IT EXISTS: of 10 open tasks carrying
     * a due date, FOUR had no assignee and THREE of those were already overdue
     * — the Myton Rail CRISI application and the Duchesne County authorization
     * (both 25 Jun) and the Case Garage pricing (19 Sep). A reminder built on
     * "important tasks that have a due date" would have been structurally
     * unable to mention any of them.
     */
    includeUnassigned?: boolean
  } = {}
): Promise<DigestTask[]> {
  let query = supabase
    .from('tasks')
    .select('id, title, why, due_date, assignee_id, project_id, opportunity_id, commitment_id')
    .eq('status', 'open')
  if (!opts.includeUnassigned) query = query.not('assignee_id', 'is', null)

  const { data: tasks, error } = await query
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(1000)

  if (error || !tasks || tasks.length === 0) return []

  // ── Protected projects ──────────────────────────────────────────────────────
  //
  // This function exists only to build the digests that go out by EMAIL —
  // Pepper's morning note and the per-member task digest. A task's own TITLE
  // routinely names the deal ("Send Hill AFB the bonding letter"), so dropping
  // the project tag would not be enough; the row goes.
  //
  // Unconditional, with no opt-out: a cron has nobody to step up, and a sent
  // email cannot be locked afterwards.
  const hidden = await hiddenProjectIds(null)
  const visibleTasks = dropHidden(tasks, (t) => t.project_id, hidden)
  if (visibleTasks.length === 0) return []

  const projectIds = [...new Set(visibleTasks.map((t) => t.project_id).filter(Boolean))] as string[]
  const opportunityIds = [...new Set(visibleTasks.map((t) => t.opportunity_id).filter(Boolean))] as string[]

  const [{ data: projects }, { data: opportunities }] = await Promise.all([
    projectIds.length > 0
      ? supabase.from('projects').select('id, name').in('id', projectIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    opportunityIds.length > 0
      ? supabase.from('opportunities').select('id, name').in('id', opportunityIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])

  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]))
  const opportunityName = new Map((opportunities ?? []).map((o) => [o.id, o.name]))

  return visibleTasks.map((t) => ({
    id: t.id,
    title: t.title,
    why: t.why,
    due_date: t.due_date,
    assignee_id: t.assignee_id,
    project_name: t.project_id ? projectName.get(t.project_id) ?? null : null,
    opportunity_name: t.opportunity_id ? opportunityName.get(t.opportunity_id) ?? null : null,
    project_id: t.project_id,
    opportunity_id: t.opportunity_id,
    commitment_id: t.commitment_id,
  }))
}

/** Render one task as a prompt-ready line: "- [Richard] Send proposal — due 2026-07-05 (3d overdue)" */
export function formatTaskLine(t: TaskSummary, now: Date = new Date()): string {
  const owner = t.assignee ? `[${t.assignee}] ` : ''
  let due = ''
  if (t.due_date) {
    const days = Math.floor((now.getTime() - new Date(t.due_date).getTime()) / 86_400_000)
    due = days > 0 ? ` — due ${t.due_date} (${days}d overdue)` : ` — due ${t.due_date}`
  }
  const proj = t.project_name ? ` (${t.project_name})` : ''
  return `- ${owner}${t.title}${due}${proj}`
}

/** Render a task list for an AI prompt, or "(none)" when empty. */
export function formatTasksForPrompt(tasks: TaskSummary[], now: Date = new Date()): string {
  if (tasks.length === 0) return '(none)'
  return tasks.map((t) => formatTaskLine(t, now)).join('\n')
}
