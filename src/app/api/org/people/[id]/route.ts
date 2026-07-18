import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { orgTier, orgPersonStatus } from '@/lib/utils/org'
import type { TablesUpdate } from '@/lib/supabase/types'

// Admin-only by default-deny (see api/org/nodes/route.ts).

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const update: TablesUpdate<'org_people'> = {}
  if (body.role !== undefined) {
    const role = (body.role as string)?.trim()
    if (!role) return Response.json({ error: 'role cannot be empty' }, { status: 400 })
    update.role = role
  }
  if (body.name !== undefined) update.name = (body.name as string)?.trim() || null
  if (body.detail !== undefined) update.detail = (body.detail as string)?.trim() || null
  if (body.status !== undefined) {
    update.status = orgPersonStatus(body.status as string)
    if (update.status === 'open') update.name = null
  }
  if (body.tier !== undefined) update.tier = orgTier(body.tier as string)
  if ('node_id' in body) update.node_id = (body.node_id as string) || null
  if (typeof body.sort_order === 'number') update.sort_order = body.sort_order

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('org_people')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ person: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  const { id } = await params

  const supabase = createAdminClient()
  const { error } = await supabase.from('org_people').delete().eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ deleted: true })
}
