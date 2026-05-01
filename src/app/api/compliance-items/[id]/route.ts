import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = await request.json()

  const { framework, requirement, status, due_date, responsible_party, evidence_doc_id, notes } = body

  const update: TablesUpdate<'compliance_items'> = {}
  if (framework !== undefined) update.framework = framework
  if (requirement !== undefined) update.requirement = requirement?.trim()
  if (status !== undefined) update.status = status
  if ('due_date' in body) update.due_date = due_date || null
  if ('responsible_party' in body) update.responsible_party = responsible_party || null
  if ('evidence_doc_id' in body) update.evidence_doc_id = evidence_doc_id || null
  if (notes !== undefined) update.notes = notes?.trim() || null

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('compliance_items')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update compliance_item failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ compliance_item: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const supabase = createAdminClient()

  const { error } = await supabase.from('compliance_items').delete().eq('id', id)

  if (error) {
    console.error('Delete compliance_item failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
