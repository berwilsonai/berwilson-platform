import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = await request.json()

  const supabase = createAdminClient()

  const update: TablesUpdate<'financing_structures'> = {
    structure_type: body.structure_type ?? null,
    senior_debt: body.senior_debt ?? null,
    mezzanine: body.mezzanine ?? null,
    equity_amount: body.equity_amount ?? null,
    equity_pct: body.equity_pct ?? null,
    ltv: body.ltv ?? null,
    interest_rate: body.interest_rate ?? null,
    lender: body.lender ?? null,
    pe_partner: body.pe_partner ?? null,
    waterfall_notes: body.waterfall_notes ?? null,
    draw_schedule: body.draw_schedule ?? null,
    notes: body.notes ?? null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('financing_structures')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update financing failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ financing: data })
}
