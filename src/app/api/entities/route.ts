import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ entities: data })
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  if (!body.name?.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }
  if (!body.entity_type) {
    return Response.json({ error: 'entity_type is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const row: TablesInsert<'entities'> = {
    name: body.name.trim(),
    entity_type: body.entity_type,
    jurisdiction: body.jurisdiction?.trim() || null,
    parent_entity_id: body.parent_entity_id || null,
    ownership_pct: body.ownership_pct != null && body.ownership_pct !== '' ? Number(body.ownership_pct) : null,
    formation_date: body.formation_date || null,
    ein: body.ein?.trim() || null,
    notes: body.notes?.trim() || null,
  }

  const { data, error } = await supabase
    .from('entities')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Create entity failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ entity: data }, { status: 201 })
}
