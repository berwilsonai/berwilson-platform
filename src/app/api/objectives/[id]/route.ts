import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { OBJECTIVE_BUCKETS, OBJECTIVE_HEALTHS } from '@/lib/utils/objectives'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** PATCH — edit objective fields (whitelisted) */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = await request.json()

  const patch: TablesUpdate<'objectives'> = {}
  if ('title' in body) patch.title = body.title?.trim() || 'Untitled objective'
  if ('note' in body) patch.note = body.note?.trim() || null
  if ('owner_id' in body) patch.owner_id = body.owner_id || null
  if ('target_date' in body) patch.target_date = body.target_date || null
  if ('bucket' in body) {
    if (!OBJECTIVE_BUCKETS.includes(body.bucket)) {
      return Response.json({ error: 'invalid bucket' }, { status: 400 })
    }
    patch.bucket = body.bucket
  }
  if ('health' in body) {
    if (!OBJECTIVE_HEALTHS.includes(body.health)) {
      return Response.json({ error: 'invalid health' }, { status: 400 })
    }
    patch.health = body.health
  }
  if ('sort_order' in body && typeof body.sort_order === 'number') {
    patch.sort_order = body.sort_order
  }
  if ('status' in body) {
    patch.status = body.status === 'archived' ? 'archived' : 'active'
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('objectives')
    .update(patch)
    .eq('id', id)
    .select('*, owner:team_members(id, name, color)')
    .single()

  if (error) {
    console.error('Update objective failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ objective: data })
}

/** DELETE — remove an objective entirely (prefer archiving; delete is for mistakes) */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase.from('objectives').delete().eq('id', id)
  if (error) {
    return Response.json({ error: 'Failed to delete objective' }, { status: 500 })
  }
  return Response.json({ deleted: true })
}
