import { NextRequest } from 'next/server'
import { getViewer, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'

interface RouteContext {
  params: Promise<{ id: string }>
}

interface PatchBody {
  active?: boolean
  name?: string
  /** On removal, move the member's open tasks to this owner (null = unassigned). */
  reassignTo?: string | null
}

/**
 * PATCH — deactivate/reactivate or rename a team member. Removal is a soft
 * deactivate (active=false) so their contact and task history survive; the
 * task board only shows active members. Optionally reassigns their open tasks.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin && viewer.role !== 'executive') {
    return forbiddenJson('Only admins can manage team members')
  }

  const { id } = await params

  let body: PatchBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const deactivating = 'active' in body && body.active === false
  // Don't let someone remove their own assignable identity out from under them.
  if (deactivating && id === viewer.teamMemberId) {
    return Response.json({ error: 'You can’t remove yourself from the task board.' }, { status: 400 })
  }

  const update: { active?: boolean; name?: string } = {}
  if ('active' in body) update.active = !!body.active
  if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim()
  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const supabase = await actorAdminClient()

  const { error } = await supabase.from('team_members').update(update).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // On removal, move their open tasks to the chosen owner (or leave unassigned).
  if (deactivating && body.reassignTo !== undefined) {
    const target = typeof body.reassignTo === 'string' && body.reassignTo ? body.reassignTo : null
    const { error: reErr } = await supabase
      .from('tasks')
      .update({ assignee_id: target })
      .eq('assignee_id', id)
      .eq('status', 'open')
    if (reErr) return Response.json({ error: reErr.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
