import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = await request.json()
  const supabase = createAdminClient()
  // Cast to bypass generated types — new vendor columns added via migration
  const db = supabase as unknown as import('@supabase/supabase-js').SupabaseClient

  // Build update payload — only include fields that were sent
  const updates: Record<string, unknown> = {}

  if ('name' in body) updates.name = body.name?.trim()
  if ('entity_type' in body) updates.entity_type = body.entity_type
  if ('jurisdiction' in body) updates.jurisdiction = body.jurisdiction?.trim() || null
  if ('parent_entity_id' in body) updates.parent_entity_id = body.parent_entity_id || null
  if ('ownership_pct' in body) updates.ownership_pct = body.ownership_pct != null && body.ownership_pct !== '' ? Number(body.ownership_pct) : null
  if ('formation_date' in body) updates.formation_date = body.formation_date || null
  if ('ein' in body) updates.ein = body.ein?.trim() || null
  if ('notes' in body) updates.notes = body.notes?.trim() || null

  // Vendor profile fields
  if ('website_url' in body) updates.website_url = body.website_url?.trim() || null
  if ('description' in body) updates.description = body.description?.trim() || null
  if ('specialties' in body) updates.specialties = Array.isArray(body.specialties) ? body.specialties : []
  if ('quality_score' in body) updates.quality_score = body.quality_score != null && body.quality_score !== '' ? Number(body.quality_score) : null
  if ('confidence_score' in body) updates.confidence_score = body.confidence_score != null && body.confidence_score !== '' ? Number(body.confidence_score) : null
  if ('headquarters' in body) updates.headquarters = body.headquarters?.trim() || null
  if ('logo_url' in body) updates.logo_url = body.logo_url?.trim() || null
  if ('primary_contact_id' in body) updates.primary_contact_id = body.primary_contact_id || null
  if ('enrichment_data' in body) updates.enrichment_data = body.enrichment_data
  if ('enriched_at' in body) updates.enriched_at = body.enriched_at

  const { data, error } = await db
    .from('entities')
    .update(updates)
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
