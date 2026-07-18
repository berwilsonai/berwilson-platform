import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { orgTier, orgPersonStatus } from '@/lib/utils/org'

// Org chart people — free-text allocations, deliberately NOT linked to
// team_members/parties. node_id null = the leadership roster (tier required);
// node_id set = staff on a division/SPV.
// Admin-only by default-deny (see api/org/nodes/route.ts).

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: {
    node_id?: string | null
    tier?: string
    name?: string
    role?: string
    detail?: string
    status?: string
    sort_order?: number
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const role = body.role?.trim()
  if (!role) {
    return Response.json({ error: 'role is required' }, { status: 400 })
  }
  const status = orgPersonStatus(body.status)
  const name = body.name?.trim()
  if (status !== 'open' && !name) {
    return Response.json({ error: 'name is required unless the position is open' }, { status: 400 })
  }
  const nodeId = body.node_id || null
  const tier = orgTier(body.tier)
  if (!nodeId && !tier) {
    return Response.json({ error: 'roster people need a tier (leadership | director)' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('org_people')
    .insert({
      node_id: nodeId,
      tier: nodeId ? null : tier,
      name: status === 'open' ? null : name,
      role,
      detail: body.detail?.trim() || null,
      status,
      sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ person: data })
}
