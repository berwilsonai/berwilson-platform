import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedInvestorSnapshot } from '@/lib/ai/embeddings'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { requirementCategory, requirementStatus } from '@/lib/utils/investors'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const update: TablesUpdate<'investor_requirements'> = {}
  if (body.category !== undefined) update.category = requirementCategory(body.category as string)
  if (body.item !== undefined) {
    const item = (body.item as string)?.trim()
    if (!item) return Response.json({ error: 'item cannot be empty' }, { status: 400 })
    update.item = item
  }
  if (body.status !== undefined) update.status = requirementStatus(body.status as string)
  if ('project_id' in body) update.project_id = (body.project_id as string) || null
  if ('evidence_doc_id' in body) update.evidence_doc_id = (body.evidence_doc_id as string) || null
  if (body.notes !== undefined) update.notes = (body.notes as string)?.trim() || null
  if (typeof body.sort_order === 'number') update.sort_order = body.sort_order

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('investor_requirements')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  embedInvestorSnapshot(data.investor_id).catch(console.error)

  return Response.json({ requirement: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  const { id } = await params

  const supabase = createAdminClient()
  // select investor_id back so the snapshot can be re-embedded post-delete
  const { data, error } = await supabase
    .from('investor_requirements')
    .delete()
    .eq('id', id)
    .select('investor_id')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  if (data?.investor_id) embedInvestorSnapshot(data.investor_id).catch(console.error)

  return Response.json({ ok: true })
}
