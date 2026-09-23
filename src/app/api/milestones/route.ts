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
  const { stage, label, target_date } = body

  // Exactly one of project_id / opportunity_id, matching the table's own check.
  const scope = scopeFromBody(body as Record<string, unknown>)
  if (!scope || !stage || !label) {
    return Response.json(
      { error: 'exactly one of project_id or opportunity_id, plus stage and label, are required' },
      { status: 400 }
    )
  }

  const viewer = await getViewer()
  if (!viewer || !(await canAccessRecord(viewer, scope.kind, scope.id))) return forbiddenJson()

  const row: TablesInsert<'milestones'> = {
    project_id: scope.kind === 'project' ? scope.id : null,
    opportunity_id: scope.kind === 'opportunity' ? scope.id : null,
    // `stage` is plain text since 2026-09-23 — a project milestone carries a
    // project_stage value, a deal milestone an opportunity pipeline value.
    stage,
    label: label.trim(),
    target_date: target_date || null,
  }

  const { data, error } = await supabase
    .from('milestones')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Add milestone failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ milestone: data })
}
