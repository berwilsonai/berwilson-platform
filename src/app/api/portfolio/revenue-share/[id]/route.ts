import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  const update: TablesUpdate<'revenue_share_agreements'> = {}
  if (body.city_pct !== undefined) update.city_pct = body.city_pct
  if (body.bw_pct !== undefined) update.bw_pct = body.bw_pct
  if (body.revenue_base !== undefined) update.revenue_base = body.revenue_base?.trim() || null
  if (body.cadence !== undefined) update.cadence = body.cadence?.trim() || null
  if (body.sunset_date !== undefined) update.sunset_date = body.sunset_date || null
  if (body.governance_notes !== undefined) update.governance_notes = body.governance_notes?.trim() || null
  if (body.notes !== undefined) update.notes = body.notes?.trim() || null

  const { data, error } = await supabase
    .from('revenue_share_agreements')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update revenue share failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ revenue_share: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabase.from('revenue_share_agreements').delete().eq('id', id)

  if (error) {
    console.error('Delete revenue share failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
