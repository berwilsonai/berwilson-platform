import { createAdminClient } from '@/lib/supabase/admin'
import { notificationRecipients } from '@/lib/notifications'

/**
 * Shared reads for Developer Notes. Route files can only export handlers, so
 * anything both a route and a page needs lives here — one spelling of the
 * select, one definition of who gets told.
 */

/** The one select shape. The page and both routes return identical rows. */
export const DEV_NOTE_SELECT = '*, reporter:team_members(id, name, color)'

/** A report with its reporter resolved, as every surface renders it. */
export interface DevNoteRow {
  id: string
  kind: string
  title: string
  body: string | null
  page_path: string | null
  user_agent: string | null
  reporter_id: string | null
  reporter_name: string | null
  status: string
  priority: string
  resolution: string | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string | null
  updated_at: string | null
  reporter?: { id: string; name: string; color: string | null } | null
}

/**
 * Notification audience for a new report: admins only.
 *
 * Deliberately narrower than `notificationRecipients()`, which is everyone with
 * a login. A bug report is addressed to whoever fixes the platform; fanning it
 * to the whole team puts someone else's UI complaint in front of people who can
 * do nothing with it, which is how a bell stops being read.
 *
 * Never throws — a failed lookup means no notification, not a failed report.
 */
export async function devNoteRecipients() {
  try {
    const all = await notificationRecipients()
    if (all.length === 0) return []
    const { data, error } = await createAdminClient()
      .from('team_members')
      .select('id')
      .eq('active', true)
      .eq('role', 'admin')
    if (error) return []
    const adminIds = new Set((data ?? []).map((m) => m.id))
    return all.filter((r) => adminIds.has(r.id))
  } catch {
    return []
  }
}

/** Count of reports still needing attention — the sidebar badge. */
export async function countOpenDevNotes(): Promise<number> {
  const { count, error } = await createAdminClient()
    .from('dev_notes')
    .select('id', { count: 'exact', head: true })
    .in('status', ['open', 'in_progress'])
  // 42P01 = migration not applied yet. No badge, not a broken shell.
  if (error) return 0
  return count ?? 0
}
