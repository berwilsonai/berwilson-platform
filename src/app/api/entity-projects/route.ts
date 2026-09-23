import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'
import { getViewer, canAccessRecord, forbiddenJson } from '@/lib/auth/viewer'
import { scopeFromBody } from '@/lib/records/scope'

export async function POST(request: NextRequest) {
  const body = await request.json()

  // Exactly one of project_id / opportunity_id, matching the table's own check.
  const scope = scopeFromBody(body as Record<string, unknown>)
  if (!scope || !body.entity_id || !body.relationship) {
    return Response.json(
      { error: 'exactly one of project_id or opportunity_id, plus entity_id and relationship, are required' },
      { status: 400 }
    )
  }

  const viewer = await getViewer()
  if (!viewer || !(await canAccessRecord(viewer, scope.kind, scope.id))) return forbiddenJson()

  const supabase = createAdminClient()

  const row: TablesInsert<'entity_projects'> = {
    entity_id: body.entity_id,
    project_id: scope.kind === 'project' ? scope.id : null,
    opportunity_id: scope.kind === 'opportunity' ? scope.id : null,
    relationship: body.relationship,
    equity_pct: body.equity_pct != null && body.equity_pct !== '' ? Number(body.equity_pct) : null,
    notes: body.notes?.trim() || null,
  }

  const { data, error } = await supabase
    .from('entity_projects')
    .insert(row)
    .select('*, entity:entities(*)')
    .single()

  if (error) {
    if (error.code === '23505') {
      return Response.json(
        { error: 'This entity already has this relationship on the record. Use a different relationship type.' },
        { status: 409 }
      )
    }
    console.error('Link entity failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ entityProject: data }, { status: 201 })
}
