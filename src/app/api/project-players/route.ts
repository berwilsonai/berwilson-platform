import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { actorAdminClient, getViewer, canAccessRecord, forbiddenJson } from '@/lib/auth/viewer'
import { scopeFromBody } from '@/lib/records/scope'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    project_id?: string
    opportunity_id?: string
    party_id: string
    role: string
    is_primary?: boolean
    notes?: string | null
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Exactly one of project_id / opportunity_id, matching the table's own check.
  const scope = scopeFromBody(body as Record<string, unknown>)
  if (!scope || !body.party_id || !body.role?.trim()) {
    return NextResponse.json(
      { error: 'exactly one of project_id or opportunity_id, plus party_id and role, are required' },
      { status: 400 }
    )
  }

  const viewer = await getViewer()
  if (!viewer || !(await canAccessRecord(viewer, scope.kind, scope.id))) return forbiddenJson()

  const admin = await actorAdminClient()

  const { data, error } = await admin
    .from('project_players')
    .insert({
      project_id: scope.kind === 'project' ? scope.id : null,
      opportunity_id: scope.kind === 'opportunity' ? scope.id : null,
      party_id: body.party_id,
      role: body.role.trim(),
      is_primary: body.is_primary ?? false,
      notes: body.notes ?? null,
    })
    .select('id')
    .single()

  if (error) {
    // The unique (scope, party, role) index — the same person twice in the
    // same role on the same record is a mis-click, not a server fault.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That person is already on this record in that role.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
