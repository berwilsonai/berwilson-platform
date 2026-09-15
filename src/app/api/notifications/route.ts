import { NextRequest } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The signed-in person's notification inbox.
 *
 * Scoped by `viewer.teamMemberId`, never by a client-supplied id — a viewer with
 * no linked team_member has no inbox, which is correct rather than empty-by-
 * accident: notifications are only ever written for linked members.
 */

const LIMIT = 25

export async function GET() {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!viewer.teamMemberId) return Response.json({ notifications: [], unread: 0 })

  const supabase = createAdminClient()

  const [{ data, error }, { count }] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, kind, title, body, href, external_url, actor_name, document_id, read_at, created_at')
      .eq('team_member_id', viewer.teamMemberId)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('team_member_id', viewer.teamMemberId)
      .is('dismissed_at', null)
      .is('read_at', null),
  ])

  if (error) {
    // The table not existing yet (migration unapplied) is an empty bell, not a
    // broken header on every page.
    if (error.code === '42P01') return Response.json({ notifications: [], unread: 0 })
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ notifications: data ?? [], unread: count ?? 0 })
}

/** Bulk actions over the whole inbox: `{ action: 'read_all' | 'dismiss_all' }`. */
export async function PATCH(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!viewer.teamMemberId) return Response.json({ ok: true })

  let body: { action?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const patch =
    body.action === 'read_all'
      ? { read_at: now }
      : body.action === 'dismiss_all'
        ? { dismissed_at: now, read_at: now }
        : null
  if (!patch) return Response.json({ error: 'Unknown action' }, { status: 400 })

  const query = createAdminClient()
    .from('notifications')
    .update(patch)
    .eq('team_member_id', viewer.teamMemberId)
    .is('dismissed_at', null)

  // Marking everything read must not rewrite rows already read — harmless, but
  // it would churn every row in the inbox on every click.
  const { error } = await (body.action === 'read_all' ? query.is('read_at', null) : query)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
