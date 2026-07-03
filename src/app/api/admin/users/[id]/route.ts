import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { isRole } from '@/lib/auth/permissions'

interface RouteContext {
  params: Promise<{ id: string }>
}

interface PatchBody {
  role?: string
  active?: boolean
  grants?: { resource_type: string; resource_id: string }[]
}

/** PATCH — update a member's role/active flag and replace their grants */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const { id } = await params

  let body: PatchBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const admin = createAdminClient()

  const update: { role?: string; active?: boolean } = {}
  if ('role' in body) {
    if (!isRole(body.role)) return Response.json({ error: 'Invalid role' }, { status: 400 })
    // Don't let the last admin demote themselves into a locked-out platform.
    if (id === viewer.teamMemberId && body.role !== 'admin') {
      const { count } = await admin
        .from('team_members')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('active', true)
        .neq('id', id)
      if ((count ?? 0) === 0) {
        return Response.json({ error: 'You are the only active admin — assign another admin first.' }, { status: 400 })
      }
    }
    update.role = body.role
  }
  if ('active' in body) update.active = !!body.active

  if (Object.keys(update).length > 0) {
    const { error } = await admin.from('team_members').update(update).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  // Replace grants wholesale when provided
  if (Array.isArray(body.grants)) {
    const { error: delError } = await admin.from('access_grants').delete().eq('team_member_id', id)
    if (delError) return Response.json({ error: delError.message }, { status: 500 })
    const rows = body.grants
      .filter((g) => (g.resource_type === 'project' || g.resource_type === 'opportunity') && g.resource_id)
      .map((g) => ({ team_member_id: id, resource_type: g.resource_type, resource_id: g.resource_id }))
    if (rows.length > 0) {
      const { error } = await admin.from('access_grants').insert(rows)
      if (error) return Response.json({ error: error.message }, { status: 500 })
    }
  }

  return Response.json({ ok: true })
}
