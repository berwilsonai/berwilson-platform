import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/types'
import { getViewer, canWorkSteel, forbiddenJson } from '@/lib/auth/viewer'
import { STEEL_STAGES } from '@/lib/utils/steel'

interface RouteContext {
  params: Promise<{ id: string }>
}

// Fields safe to patch inline from the detail page (stage pill, quick edits).
const PATCHABLE = new Set([
  'stage', 'next_step', 'next_step_date', 'expected_delivery_date', 'salesperson_id',
])

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  // Middleware already limits /api/steel to admin/executive/steel_sales;
  // this check is defense-in-depth.
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return forbiddenJson()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const update: TablesUpdate<'steel_deals'> = {}
  for (const [key, value] of Object.entries(body)) {
    if (PATCHABLE.has(key)) {
      // @ts-expect-error — key is constrained to PATCHABLE keys
      update[key] = value
    }
  }

  if (typeof update.stage === 'string' && !(STEEL_STAGES as string[]).includes(update.stage)) {
    return Response.json({ error: 'Invalid stage' }, { status: 400 })
  }

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No patchable fields provided' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('steel_deals')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ deal: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson('Only admins can delete deals')

  const { id } = await params
  const admin = createAdminClient()

  // Notes cascade with the deal.
  const { error } = await admin.from('steel_deals').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
