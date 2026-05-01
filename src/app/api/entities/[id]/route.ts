import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = await request.json()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('entities')
    .update({
      name: body.name?.trim(),
      entity_type: body.entity_type,
      jurisdiction: body.jurisdiction?.trim() || null,
      parent_entity_id: body.parent_entity_id || null,
      ownership_pct: body.ownership_pct != null && body.ownership_pct !== '' ? Number(body.ownership_pct) : null,
      formation_date: body.formation_date || null,
      ein: body.ein?.trim() || null,
      notes: body.notes?.trim() || null,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update entity failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ entity: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const supabase = createAdminClient()

  // Prevent deleting entities that have children referencing them
  const { count: childCount } = await supabase
    .from('entities')
    .select('*', { count: 'exact', head: true })
    .eq('parent_entity_id', id)

  if ((childCount ?? 0) > 0) {
    return Response.json(
      { error: 'Cannot delete: this entity has child entities. Reassign them first.' },
      { status: 409 }
    )
  }

  const { error } = await supabase.from('entities').delete().eq('id', id)

  if (error) {
    console.error('Delete entity failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return new Response(null, { status: 204 })
}
