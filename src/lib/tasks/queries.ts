/**
 * Shared task queries — the `tasks` table is the single source of truth for
 * action items across attention, calendar, briefs, and the agent.
 * (Replaces the legacy `updates.action_items` JSON reads, removed 2026-07-02.)
 */

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
  if (opts.dueBefore) q = q.lte('due_date', opts.dueBefore)
  if (opts.dueAfter) q = q.gte('due_date', opts.dueAfter)
  if (opts.requireDueDate || opts.dueBefore || opts.dueAfter) q = q.not('due_date', 'is', null)

  const { data: tasks, error } = await q
  if (error || !tasks || tasks.length === 0) return []

  const projectIds = [...new Set(tasks.map((t) => t.project_id).filter(Boolean))] as string[]

  const [{ data: members }, { data: projects }] = await Promise.all([
    supabase.from('team_members').select('id, name'),
    projectIds.length > 0
      ? supabase.from('projects').select('id, name').in('id', projectIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])

  const memberName = new Map((members ?? []).map((m) => [m.id, m.name]))
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]))

  return tasks.map((t) => ({
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
}

/**
 * Fetch open, due-dated tasks for the per-member notification digest.
 * Kept separate from `fetchOpenTasks`/`TaskSummary` (shared by the AI briefs)
 * because the digest needs `assignee_id` + `why` and groups by person.
 * Name resolution uses separate lookups (no PostgREST embeds) for dual-schema safety.
 */
export async function fetchTasksForDigest(supabase: AdminClient): Promise<DigestTask[]> {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, why, due_date, assignee_id, project_id, opportunity_id')
    .eq('status', 'open')
    .not('assignee_id', 'is', null)
    .not('due_date', 'is', null)
    .order('due_date', { ascending: true })
    .limit(1000)

  if (error || !tasks || tasks.length === 0) return []

  const projectIds = [...new Set(tasks.map((t) => t.project_id).filter(Boolean))] as string[]
  const opportunityIds = [...new Set(tasks.map((t) => t.opportunity_id).filter(Boolean))] as string[]

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

  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    why: t.why,
    due_date: t.due_date,
    assignee_id: t.assignee_id,
    project_name: t.project_id ? projectName.get(t.project_id) ?? null : null,
    opportunity_name: t.opportunity_id ? opportunityName.get(t.opportunity_id) ?? null : null,
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
