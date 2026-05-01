import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'

export async function POST(request: NextRequest) {
  const body = await request.json()

  if (!body.entity_id || !body.project_id || !body.relationship) {
    return Response.json(
      { error: 'entity_id, project_id, and relationship are required' },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()

  const row: TablesInsert<'entity_projects'> = {
    entity_id: body.entity_id,
    project_id: body.project_id,
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
        { error: 'This entity already has this relationship on the project. Use a different relationship type.' },
        { status: 409 }
      )
    }
    console.error('Link entity failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ entityProject: data }, { status: 201 })
}
