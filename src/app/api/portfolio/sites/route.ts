import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesInsert } from '@/lib/supabase/types'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('sites')
    .select('*, corridor:corridors(id, name, brand:brands(id, code, name))')
    .order('site_number')

  if (error) {
    console.error('List sites failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ sites: data })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, ...fields } = body

  if (!name) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  const row: TablesInsert<'sites'> = {
    name: name.trim(),
    corridor_id: fields.corridor_id || null,
    site_number: fields.site_number ?? null,
    city: fields.city || null,
    county: fields.county || null,
    state: fields.state || null,
    status: fields.status || null,
    bw_role: fields.bw_role || null,
    military_nexus: fields.military_nexus ?? null,
    military_installations: fields.military_installations || null,
    is_lead_site: fields.is_lead_site ?? false,
    anchor_partner: fields.anchor_partner || null,
    stracnet_status: fields.stracnet_status || null,
    notes: fields.notes?.trim() || null,
  }

  const { data, error } = await supabase
    .from('sites')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Create site failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ site: data })
}
