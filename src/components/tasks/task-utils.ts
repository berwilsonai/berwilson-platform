// Shared types + helpers for the team task board and the project tasks tab.

export interface BoardTask {
  id: string
  title: string
  what: string | null
  why: string | null
  how: string | null
  due_date: string | null
  status: string
  assignee_id: string | null
  project_id: string | null
  opportunity_id: string | null
  objective_id: string | null
  assignee: { id: string; name: string; color: string | null } | null
  project: { id: string; name: string } | null
  created_at: string | null
}

export interface TeamMember {
  id: string
  name: string
  color: string | null
}

export interface ProjectOption {
  id: string
  name: string
}

export interface OpportunityOption {
  id: string
  name: string
}

export interface ObjectiveOption {
  id: string
  title: string
  bucket: string
}

/**
 * If a fetch came back 401 (expired session — common on long-lived mobile tabs),
 * tell the user and bounce them to login. Returns true when it handled an auth
 * failure so the caller can stop. Without this, a redirected-to-login response
 * is silently followed by fetch and surfaces as a generic "failed" toast.
 */
export function handleAuthError(res: Response): boolean {
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      const next = encodeURIComponent(window.location.pathname)
      window.location.href = `/login?next=${next}`
    }
    return true
  }
  return false
}

export function formatDate(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function getDueLabel(due: string): { label: string; urgent: boolean; overdue: boolean } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate = new Date(due + 'T00:00:00')
  const diffMs = dueDate.getTime() - today.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, urgent: true, overdue: true }
  if (diffDays === 0) return { label: 'Due today', urgent: true, overdue: false }
  if (diffDays === 1) return { label: 'Due tomorrow', urgent: true, overdue: false }
  if (diffDays <= 7) return { label: `Due in ${diffDays}d`, urgent: true, overdue: false }
  return { label: `Due ${formatDate(due)}`, urgent: false, overdue: false }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Full literal class strings so Tailwind's JIT keeps them (no dynamic interpolation).
const AVATAR_CLASSES: Record<string, string> = {
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
}

export function avatarClasses(color: string | null | undefined): string {
  return AVATAR_CLASSES[color ?? ''] ?? 'bg-muted text-muted-foreground'
}
