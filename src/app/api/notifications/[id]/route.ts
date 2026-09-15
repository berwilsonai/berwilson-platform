import { NextRequest } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'

/** PATCH one notification: `{ read?: true, dismissed?: true }`. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!viewer.teamMemberId) return Response.json({ error: 'Not found' }, { status: 404 })

  const { id } = await params

  let body: { read?: boolean; dismissed?: boolean }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const patch: { read_at?: string; dismissed_at?: string } = {}
  if (body.read) patch.read_at = now
  // Dismissing implies reading it — otherwise a cleared inbox can leave an
  // unread count behind it with nothing to open.
  if (body.dismissed) {
    patch.dismissed_at = now
    patch.read_at = now
  }
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // Scoped to the viewer's own row: the id alone must never be enough to touch
  // somebody else's inbox.
  const { error } = await createAdminClient()
    .from('notifications')
    .update(patch)
    .eq('id', id)
    .eq('team_member_id', viewer.teamMemberId)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
