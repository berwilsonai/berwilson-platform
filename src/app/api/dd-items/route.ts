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
  const { category, item, severity, status, assigned_to, notes } = body

  // Exactly one of project_id / opportunity_id, matching the table's own check.
  const scope = scopeFromBody(body as Record<string, unknown>)
  if (!scope || !category || !item) {
    return Response.json(
      { error: 'exactly one of project_id or opportunity_id, plus category and item, are required' },
      { status: 400 }
    )
  }

  const viewer = await getViewer()
  if (!viewer || !(await canAccessRecord(viewer, scope.kind, scope.id))) return forbiddenJson()

  const row: TablesInsert<'dd_items'> = {
    project_id: scope.kind === 'project' ? scope.id : null,
    opportunity_id: scope.kind === 'opportunity' ? scope.id : null,
    category,
    item: item.trim(),
    severity: severity ?? 'info',
    status: status ?? 'open',
    assigned_to: assigned_to || null,
    notes: notes?.trim() || null,
  }

  const { data, error } = await supabase
    .from('dd_items')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Add dd_item failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ dd_item: data })
}
