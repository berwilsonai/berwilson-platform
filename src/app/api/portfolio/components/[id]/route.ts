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

  const update: TablesUpdate<'components'> = {}
  if (body.type !== undefined) update.type = body.type
  if (body.name !== undefined) update.name = body.name?.trim()
  if (body.specs !== undefined) update.specs = body.specs || null
  if (body.capital_low !== undefined) update.capital_low = body.capital_low
  if (body.capital_mid !== undefined) update.capital_mid = body.capital_mid
  if (body.capital_high !== undefined) update.capital_high = body.capital_high
  if (body.contingency_pct !== undefined) update.contingency_pct = body.contingency_pct
  if (body.phase !== undefined) update.phase = body.phase || null
  if (body.start_date !== undefined) update.start_date = body.start_date || null
  if (body.end_date !== undefined) update.end_date = body.end_date || null
  if (body.duration_months !== undefined) update.duration_months = body.duration_months
  if (body.bw_role !== undefined) update.bw_role = body.bw_role || null
  if (body.prime_contractor !== undefined) update.prime_contractor = body.prime_contractor || null
  if (body.status !== undefined) update.status = body.status || null
  if (body.procore_link !== undefined) update.procore_link = body.procore_link || null
  if (body.project_id !== undefined) update.project_id = body.project_id || null
  if (body.notes !== undefined) update.notes = body.notes?.trim() || null

  const { data, error } = await supabase
    .from('components')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update component failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ component: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabase.from('components').delete().eq('id', id)

  if (error) {
    console.error('Delete component failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
