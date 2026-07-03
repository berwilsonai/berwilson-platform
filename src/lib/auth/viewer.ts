import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Role } from './permissions'
import { isRole } from './permissions'

// Resolves the signed-in auth user to a platform role + grants.
//
// Resolution rules (must stay in sync with middleware.ts):
// 1. Pre-migration (team_members has no role/auth_user_id columns): everyone
//    is admin — identical to today's behavior, so the code can ship first.
// 2. Bootstrap (migration applied but NO team_member linked yet): everyone is
//    admin, so Richard can't lock himself out before linking his own account.
// 3. Linked user: their team_member row's role.
// 4. Unlinked user once linking has started: member (own tasks only) — the
//    safe default for an auth account nobody has classified yet.

export interface Viewer {
  authUserId: string
  email: string | null
  role: Role
  isAdmin: boolean
  teamMemberId: string | null
  teamMemberName: string | null
  /** Direct grants (project_manager only) — parent-project grants NOT yet expanded. */
  grantedProjectIds: string[]
  grantedOpportunityIds: string[]
  /** True while the user-access migration hasn't been applied. */
  preMigration: boolean
  /** True while no team_member is linked to an auth user (setup not started). */
  bootstrap: boolean
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const base = {
    authUserId: user.id,
    email: user.email ?? null,
    teamMemberId: null as string | null,
    teamMemberName: null as string | null,
    grantedProjectIds: [] as string[],
    grantedOpportunityIds: [] as string[],
  }

  const admin = createAdminClient()
  const { data: members, error } = await admin
    .from('team_members')
    .select('id, name, role, auth_user_id, active')

  if (error) {
    // Missing columns (42703) → migration not applied → today's behavior.
    return { ...base, role: 'admin', isAdmin: true, preMigration: true, bootstrap: false }
  }

  const linked = (members ?? []).filter((m) => m.auth_user_id)
  if (linked.length === 0) {
    return { ...base, role: 'admin', isAdmin: true, preMigration: false, bootstrap: true }
  }

  const me = linked.find((m) => m.auth_user_id === user.id)
  if (!me || !me.active) {
    return { ...base, role: 'member', isAdmin: false, preMigration: false, bootstrap: false }
  }

  const role: Role = isRole(me.role) ? me.role : 'member'
  const viewer: Viewer = {
    ...base,
    role,
    isAdmin: role === 'admin',
    teamMemberId: me.id,
    teamMemberName: me.name,
    preMigration: false,
    bootstrap: false,
  }

  if (role === 'project_manager') {
    const { data: grants } = await admin
      .from('access_grants')
      .select('resource_type, resource_id')
      .eq('team_member_id', me.id)
    for (const g of grants ?? []) {
      if (g.resource_type === 'project') viewer.grantedProjectIds.push(g.resource_id)
      else if (g.resource_type === 'opportunity') viewer.grantedOpportunityIds.push(g.resource_id)
    }
  }

  return viewer
})

/**
 * Full set of project ids a viewer can access: direct grants plus every
 * descendant (a grant on a parent/program project covers its children).
 * Admin/executive callers shouldn't need this — returns null meaning "all".
 */
export async function accessibleProjectIds(viewer: Viewer): Promise<Set<string> | null> {
  if (viewer.role === 'admin' || viewer.role === 'executive') return null
  if (viewer.grantedProjectIds.length === 0) return new Set()

  const admin = createAdminClient()
  const { data: projects } = await admin.from('projects').select('id, parent_project_id')

  const childrenOf = new Map<string, string[]>()
  for (const p of projects ?? []) {
    if (!p.parent_project_id) continue
    const list = childrenOf.get(p.parent_project_id) ?? []
    list.push(p.id)
    childrenOf.set(p.parent_project_id, list)
  }

  const result = new Set<string>()
  const queue = [...viewer.grantedProjectIds]
  while (queue.length) {
    const id = queue.pop()!
    if (result.has(id)) continue
    result.add(id)
    queue.push(...(childrenOf.get(id) ?? []))
  }
  return result
}

export async function canAccessProject(viewer: Viewer, projectId: string): Promise<boolean> {
  if (viewer.role === 'admin') return true
  if (viewer.role !== 'project_manager') return false
  if (viewer.grantedProjectIds.includes(projectId)) return true
  if (viewer.grantedProjectIds.length === 0) return false

  // Walk up the parent chain — a grant on any ancestor covers this project.
  const admin = createAdminClient()
  let current: string | null = projectId
  for (let depth = 0; depth < 10 && current; depth++) {
    const { data }: { data: { parent_project_id: string | null } | null } = await admin
      .from('projects')
      .select('parent_project_id')
      .eq('id', current)
      .maybeSingle()
    current = data?.parent_project_id ?? null
    if (current && viewer.grantedProjectIds.includes(current)) return true
  }
  return false
}

export function canAccessOpportunity(viewer: Viewer, opportunityId: string): boolean {
  if (viewer.role === 'admin') return true
  return viewer.role === 'project_manager' && viewer.grantedOpportunityIds.includes(opportunityId)
}

/** Task-level check given the task's tags. Executives manage the whole board. */
export async function canAccessTask(
  viewer: Viewer,
  task: { assignee_id: string | null; project_id: string | null; opportunity_id?: string | null }
): Promise<boolean> {
  if (viewer.role === 'admin' || viewer.role === 'executive') return true
  if (viewer.teamMemberId && task.assignee_id === viewer.teamMemberId) return true
  if (viewer.role !== 'project_manager') return false
  if (task.project_id && (await canAccessProject(viewer, task.project_id))) return true
  if (task.opportunity_id && canAccessOpportunity(viewer, task.opportunity_id)) return true
  return false
}

export function forbiddenJson(message = 'Not authorized') {
  return Response.json({ error: message }, { status: 403 })
}

interface TaskTags {
  assignee_id: string | null
  project_id: string | null
  opportunity_id?: string | null
}

/**
 * Narrow a fetched task list to what the viewer may see. Admin/executive see
 * everything; project_manager sees tasks on granted projects/opportunities or
 * assigned to them; member sees only their own. (Tables are small — filtering
 * in memory keeps this tolerant of the pre-migration opportunity_id column.)
 */
export async function filterTasksForViewer<T extends TaskTags>(viewer: Viewer, tasks: T[]): Promise<T[]> {
  if (viewer.role === 'admin' || viewer.role === 'executive') return tasks
  const mine = (t: TaskTags) => !!viewer.teamMemberId && t.assignee_id === viewer.teamMemberId
  if (viewer.role === 'member') return tasks.filter(mine)

  const projectIds = (await accessibleProjectIds(viewer)) ?? new Set<string>()
  const oppIds = new Set(viewer.grantedOpportunityIds)
  return tasks.filter(
    (t) => mine(t) || (t.project_id && projectIds.has(t.project_id)) || (t.opportunity_id && oppIds.has(t.opportunity_id))
  )
}

/** Can the viewer create a task carrying these tags? Enforced in POST /api/tasks. */
export async function canCreateTask(viewer: Viewer, tags: TaskTags): Promise<boolean> {
  if (viewer.role === 'admin' || viewer.role === 'executive') return true
  if (viewer.role === 'member') {
    // Members only add to their own list, untagged.
    return !tags.project_id && !tags.opportunity_id && !!viewer.teamMemberId && tags.assignee_id === viewer.teamMemberId
  }
  if (tags.project_id) return canAccessProject(viewer, tags.project_id)
  if (tags.opportunity_id) return canAccessOpportunity(viewer, tags.opportunity_id)
  return !!viewer.teamMemberId && tags.assignee_id === viewer.teamMemberId
}
