import { NextRequest, NextResponse } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * PUT /api/parties/[id]/company — set (or clear) the contact's primary
 * company/vendor link. Body:
 *   { entity_id: string }            — link to an existing vendor
 *   { company_name: string }         — find-or-create a vendor by name, then link
 *   { entity_id: null }              — unlink (clears parties.company too)
 * Keeps parties.company (the display text) in sync with the link.
 */
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  let body: { entity_id?: string | null; company_name?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const supabase = await actorAdminClient()

  const { data: party } = await supabase
    .from('parties')
    .select('id')
    .eq('id', id)
    .single()
  if (!party) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  // Unlink
  if (body.entity_id === null && !body.company_name) {
    await supabase.from('party_entities').delete().eq('party_id', id).eq('is_primary', true)
    const { error } = await supabase.from('parties').update({ company: null }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, entity: null })
  }

  // Resolve the entity: explicit id, or find-or-create by name
  let entityId = body.entity_id ?? null
  let entityName: string | null = null

  if (entityId) {
    const { data: entity } = await supabase
      .from('entities')
      .select('id, name')
      .eq('id', entityId)
      .single()
    if (!entity) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    entityName = entity.name
  } else {
    const name = body.company_name?.trim()
    if (!name) return NextResponse.json({ error: 'entity_id or company_name is required' }, { status: 400 })

    const { data: existing } = await supabase
      .from('entities')
      .select('id, name')
      .ilike('name', name)
      .limit(1)
      .maybeSingle()

    if (existing) {
      entityId = existing.id
      entityName = existing.name
    } else {
      const { data: created, error: createError } = await supabase
        .from('entities')
        .insert({ name, entity_type: 'other' })
        .select('id, name')
        .single()
      if (createError || !created) {
        return NextResponse.json({ error: createError?.message ?? 'Failed to create vendor' }, { status: 500 })
      }
      entityId = created.id
      entityName = created.name
    }
  }

  // Replace the primary link
  await supabase.from('party_entities').delete().eq('party_id', id).eq('is_primary', true)
  const { error: linkError } = await supabase
    .from('party_entities')
    .insert({ party_id: id, entity_id: entityId, role: 'employee', is_primary: true })
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 })

  const { error: companyError } = await supabase
    .from('parties')
    .update({ company: entityName })
    .eq('id', id)
  if (companyError) return NextResponse.json({ error: companyError.message }, { status: 500 })

  return NextResponse.json({ ok: true, entity: { id: entityId, name: entityName } })
}
