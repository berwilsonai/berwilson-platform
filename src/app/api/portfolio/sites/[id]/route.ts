import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data, error } = await supabase
    .from('sites')
    .select(`
      *,
      corridor:corridors(id, name, brand:brands(id, code, name)),
      components(*),
      funding_sources(*),
      revenue_share_agreements(*),
      stakeholder_relationships(*, party:parties(id, full_name, company, title, email))
    `)
    .eq('id', id)
    .single()

  if (error) {
    console.error('Get site failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ site: data })
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  const update: TablesUpdate<'sites'> = {}
  if (body.name !== undefined) update.name = body.name?.trim()
  if (body.corridor_id !== undefined) update.corridor_id = body.corridor_id || null
  if (body.site_number !== undefined) update.site_number = body.site_number
  if (body.city !== undefined) update.city = body.city || null
  if (body.county !== undefined) update.county = body.county || null
  if (body.state !== undefined) update.state = body.state || null
  if (body.status !== undefined) update.status = body.status || null
  if (body.bw_role !== undefined) update.bw_role = body.bw_role || null
  if (body.military_nexus !== undefined) update.military_nexus = body.military_nexus
  if (body.military_installations !== undefined) update.military_installations = body.military_installations || null
  if (body.is_lead_site !== undefined) update.is_lead_site = body.is_lead_site
  if (body.anchor_partner !== undefined) update.anchor_partner = body.anchor_partner || null
  if (body.stracnet_status !== undefined) update.stracnet_status = body.stracnet_status || null
  if (body.notes !== undefined) update.notes = body.notes?.trim() || null

  const { data, error } = await supabase
    .from('sites')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update site failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ site: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabase.from('sites').delete().eq('id', id)

  if (error) {
    console.error('Delete site failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
