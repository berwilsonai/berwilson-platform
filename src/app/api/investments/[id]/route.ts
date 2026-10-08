import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedInvestorSnapshot } from '@/lib/ai/embeddings'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { vehicleTargetError } from '@/lib/spvs/portfolio'
import {
  parseInvestmentFields,
  TARGET_COLUMNS,
  type InvestmentBody,
} from '@/lib/investors/parse'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson()

  let body: InvestmentBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = parseInvestmentFields(body)
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })

  // Partial update: only apply keys the caller actually sent (the parser fills
  // defaults for everything else).
  const provided = new Set(Object.keys(body))
  const update: Partial<typeof result.fields> = {}
  for (const [key, value] of Object.entries(result.fields)) {
    if (provided.has(key)) (update as Record<string, unknown>)[key] = value
  }
  // ⚠ ALL THREE TARGET COLUMNS TRAVEL TOGETHER, OR THE CHECK CONSTRAINT FIRES.
  // `investments_target_check` demands exactly one of project_id / spv_id be
  // set for its kind, so moving a commitment from a vehicle back to the parent
  // company while sending only `target_kind` would leave the old `spv_id` in
  // place and fail — a 500 the reader reads as their own mistake. This was
  // already true of `project_id` alone; adding a second target column is what
  // makes forgetting it certain.
  if (provided.has('target_kind')) {
    for (const column of TARGET_COLUMNS) {
      ;(update as Record<string, unknown>)[column] = result.fields[column]
    }
  }
  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No fields provided' }, { status: 400 })
  }

  // A vehicle that was renamed away or removed while this form sat open.
  const vehicleError = await vehicleTargetError(result.fields.spv_id)
  if (vehicleError) return Response.json({ error: vehicleError }, { status: 400 })

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
  if (!viewer?.isAdmin) return forbiddenJson('Only admins can delete investments')

  const { id } = await params
  const supabase = createAdminClient()

  // Grab the parent before deleting so the snapshot can be refreshed
  const { data: row } = await supabase.from('investments').select('investor_id').eq('id', id).maybeSingle()

  const { error } = await supabase.from('investments').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  if (row?.investor_id) embedInvestorSnapshot(row.investor_id).catch(console.error)

  return Response.json({ success: true })
}
