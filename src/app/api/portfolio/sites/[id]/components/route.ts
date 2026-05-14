import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesInsert } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data, error } = await supabase
    .from('components')
    .select('*')
    .eq('site_id', id)
    .order('created_at')

  if (error) {
    console.error('List components failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ components: data })
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const { type, name, ...fields } = body

  if (!type || !name) {
    return Response.json(
      { error: 'type and name are required' },
      { status: 400 }
    )
  }

  const row: TablesInsert<'components'> = {
    site_id: id,
    type,
    name: name.trim(),
    specs: fields.specs || null,
    capital_low: fields.capital_low ?? null,
    capital_mid: fields.capital_mid ?? null,
    capital_high: fields.capital_high ?? null,
    contingency_pct: fields.contingency_pct ?? null,
    phase: fields.phase || null,
    start_date: fields.start_date || null,
    end_date: fields.end_date || null,
    duration_months: fields.duration_months ?? null,
    bw_role: fields.bw_role || null,
    prime_contractor: fields.prime_contractor || null,
    status: fields.status || null,
    procore_link: fields.procore_link || null,
    project_id: fields.project_id || null,
    notes: fields.notes?.trim() || null,
  }

  const { data, error } = await supabase
    .from('components')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Create component failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ component: data })
}
