import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedInvestorSnapshot } from '@/lib/ai/embeddings'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { parseInvestmentFields, type InvestmentBody } from '@/lib/investors/parse'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: InvestmentBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = parseInvestmentFields(body)
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })

  // Partial update: only apply keys the caller actually sent (the parser fills
  // defaults for everything else). Target kind + project travel as a pair.
  const provided = new Set(Object.keys(body))
  const update: Partial<typeof result.fields> = {}
  for (const [key, value] of Object.entries(result.fields)) {
    if (provided.has(key)) (update as Record<string, unknown>)[key] = value
  }
  if (provided.has('target_kind')) update.project_id = result.fields.project_id
  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No fields provided' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('investments')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  await supabase.from('investors').update({ updated_at: new Date().toISOString() }).eq('id', data.investor_id)

  // Refresh the searchable snapshot (skips pre-migration)
  embedInvestorSnapshot(data.investor_id).catch(console.error)

  return Response.json({ investment: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson('Only admins can delete investments')

  const { id } = await params
  const supabase = createAdminClient()

  // Grab the parent before deleting so the snapshot can be refreshed
  const { data: row } = await supabase.from('investments').select('investor_id').eq('id', id).maybeSingle()

  const { error } = await supabase.from('investments').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  if (row?.investor_id) embedInvestorSnapshot(row.investor_id).catch(console.error)

  return Response.json({ success: true })
}
