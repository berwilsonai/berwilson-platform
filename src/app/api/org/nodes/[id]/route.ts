import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { orgEntityType } from '@/lib/utils/org'
import type { TablesUpdate } from '@/lib/supabase/types'

// Admin-only by default-deny (see api/org/nodes/route.ts).

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

  const supabase = createAdminClient()

  const update: TablesUpdate<'org_nodes'> = {}
  if (body.name !== undefined) {
    const name = (body.name as string)?.trim()
    if (!name) return Response.json({ error: 'name cannot be empty' }, { status: 400 })
    update.name = name
  }
  if (body.vertical !== undefined) update.vertical = (body.vertical as string)?.trim() || null
  if (body.location !== undefined) update.location = (body.location as string)?.trim() || null
  if (body.note !== undefined) update.note = (body.note as string)?.trim() || null
  if (typeof body.sort_order === 'number') update.sort_order = body.sort_order
  if (body.entity_type !== undefined) {
    // Divisions/SPVs are held to the series|standalone vocab; arms carry free
    // text — so the coercion depends on the row's kind.
    const { data: existing } = await supabase
      .from('org_nodes')
      .select('kind')
      .eq('id', id)
      .single()
    update.entity_type =
      existing?.kind === 'division' || existing?.kind === 'spv'
        ? orgEntityType(body.entity_type as string)
        : (body.entity_type as string)?.trim() || null
  }

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('org_nodes')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ node: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  const { id } = await params

  const supabase = createAdminClient()
  // FK cascade removes child SPVs and any staff allocated to this subtree.
  const { error } = await supabase.from('org_nodes').delete().eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ deleted: true })
}
