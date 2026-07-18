// Role presets + section access. Pure module — no server deps — so the
// middleware, nav components, and API routes all gate against the same map.
//
// The model (see CLAUDE.md §8 / user-access migration):
//   admin           — everything
//   executive       — Tasks + Objectives, full edit; no deal detail, no AI/directory
//   project_manager — granted projects/opportunities + tasks within them
//   member          — own task list only
// Anything not explicitly allowed for a role is admin-only by default, so a
// new route is private until deliberately opened up.

export type Role = 'admin' | 'executive' | 'project_manager' | 'member'

export const ROLES: Role[] = ['admin', 'executive', 'project_manager', 'member']

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  executive: 'Executive',
  project_manager: 'Project Manager',
  member: 'Team Member',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Full access to the entire platform, including user management.',
  executive: 'Tasks and Objectives with full edit. No projects, AI, or directory.',
  project_manager: 'Granted projects & opportunities, plus tasks within them.',
  member: 'Their own task list only.',
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as string[]).includes(value)
}

// Page path prefixes each non-admin role may visit. A prefix matches the exact
// path or any subpath. Admin is unrestricted.
// The project map (/map + /api/map) is deliberately admin-only for now — it
// shows the whole portfolio. To open it to PMs/execs later, add those prefixes
// here and filter the /map page's fetch via accessibleProjectIds.
// Every role may VIEW the org structure chart (/company/structure); editing it
// stays admin-only (the /api/org mutation routes are not allowlisted below and
// carry in-route admin guards). The rest of /company remains admin-only —
// prefix matching means '/company/structure' does not grant '/company'.
const ROLE_PAGE_PREFIXES: Record<Exclude<Role, 'admin'>, string[]> = {
  executive: ['/tasks', '/objectives', '/company/structure'],
  project_manager: ['/tasks', '/projects', '/opportunities', '/company/structure'],
  member: ['/tasks', '/company/structure'],
}

// API path prefixes each non-admin role may call. Fine-grained checks (which
// project, whose task) happen inside the routes via lib/auth/viewer.
const ROLE_API_PREFIXES: Record<Exclude<Role, 'admin'>, string[]> = {
  executive: ['/api/tasks', '/api/objectives', '/api/team-members'],
  project_manager: [
    '/api/tasks',
    '/api/team-members',
    '/api/projects',
    '/api/opportunities',
    '/api/documents',
    '/api/milestones',
  ],
  member: ['/api/tasks', '/api/team-members'],
}

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export function canAccessPage(role: Role, pathname: string): boolean {
  if (role === 'admin') return true
  return matchesPrefix(pathname, ROLE_PAGE_PREFIXES[role])
}

export function canAccessApi(role: Role, pathname: string): boolean {
  if (role === 'admin') return true
  return matchesPrefix(pathname, ROLE_API_PREFIXES[role])
}

// Where an unauthorized page hit gets sent. /tasks is reachable by every role,
// so this can never redirect-loop.
export const DEFAULT_LANDING = '/tasks'
