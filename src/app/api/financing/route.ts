import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesInsert } from '@/lib/supabase/types'
import { getViewer, canAccessRecord, forbiddenJson } from '@/lib/auth/viewer'
import { scopeFromBody } from '@/lib/records/scope'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const fields = body

  // Exactly one of project_id / opportunity_id, matching the table's own check.
  const scope = scopeFromBody(body as Record<string, unknown>)
  if (!scope) {
    return Response.json({ error: 'exactly one of project_id or opportunity_id is required' }, { status: 400 })
  }

  const viewer = await getViewer()
  if (!viewer || !(await canAccessRecord(viewer, scope.kind, scope.id))) return forbiddenJson()

  const row: TablesInsert<'financing_structures'> = {
    project_id: scope.kind === 'project' ? scope.id : null,
    opportunity_id: scope.kind === 'opportunity' ? scope.id : null,
    structure_type: fields.structure_type || null,
    senior_debt: fields.senior_debt ?? null,
    mezzanine: fields.mezzanine ?? null,
    equity_amount: fields.equity_amount ?? null,
    equity_pct: fields.equity_pct ?? null,
    ltv: fields.ltv ?? null,
    interest_rate: fields.interest_rate ?? null,
    lender: fields.lender || null,
    pe_partner: fields.pe_partner || null,
    waterfall_notes: fields.waterfall_notes || null,
    draw_schedule: fields.draw_schedule ?? null,
    notes: fields.notes || null,
  }

  const { data, error } = await supabase
    .from('financing_structures')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Create financing failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ financing: data })
}
