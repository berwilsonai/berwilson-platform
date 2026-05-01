import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { project_id, framework, requirement, status, due_date, responsible_party, evidence_doc_id, notes } = body

  if (!framework || !requirement) {
    return Response.json(
      { error: 'framework and requirement are required' },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()

  const row: TablesInsert<'compliance_items'> = {
    project_id: project_id || null,
    framework,
    requirement: requirement.trim(),
    status: status ?? 'not_started',
    due_date: due_date || null,
    responsible_party: responsible_party || null,
    evidence_doc_id: evidence_doc_id || null,
    notes: notes?.trim() || null,
  }

  const { data, error } = await supabase
    .from('compliance_items')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Add compliance_item failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ compliance_item: data })
}
