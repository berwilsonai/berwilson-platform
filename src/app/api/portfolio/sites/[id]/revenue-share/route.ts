import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesInsert } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  const row: TablesInsert<'revenue_share_agreements'> = {
    site_id: id,
    city_pct: body.city_pct ?? null,
    bw_pct: body.bw_pct ?? null,
    revenue_base: body.revenue_base?.trim() || null,
    cadence: body.cadence?.trim() || null,
    sunset_date: body.sunset_date || null,
    governance_notes: body.governance_notes?.trim() || null,
    notes: body.notes?.trim() || null,
  }

  const { data, error } = await supabase
    .from('revenue_share_agreements')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Create revenue share failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ revenue_share: data })
}
