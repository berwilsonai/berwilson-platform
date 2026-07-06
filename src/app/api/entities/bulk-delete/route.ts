import { NextRequest, NextResponse } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'

/**
 * POST /api/entities/bulk-delete — hard-delete many vendors at once.
 * Body: { ids: string[] }. Same semantics as the single DELETE route;
 * project links, party links, docs, and chunks cascade. Child entities
 * whose parent is being deleted must be in the same batch (or the FK
 * check fails and nothing is deleted).
 */
export async function POST(request: NextRequest) {
  let body: { ids?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []

  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids is required' }, { status: 400 })
  }
  if (ids.length > 1000) {
    return NextResponse.json({ error: 'Too many ids (max 1000)' }, { status: 400 })
  }

  const supabase = await actorAdminClient()

  // Children outside the batch would violate the parent FK — surface it clearly.
  const { data: blockers } = await supabase
    .from('entities')
    .select('id, name, parent_entity_id')
    .in('parent_entity_id', ids)
  const outside = (blockers ?? []).filter(b => !ids.includes(b.id))
  if (outside.length > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${outside.length} child entit${outside.length === 1 ? 'y' : 'ies'} (e.g. "${outside[0].name}") reference a vendor in this selection. Include or reassign them first.` },
      { status: 409 }
    )
  }

  const { data, error } = await supabase
    .from('entities')
    .delete()
    .in('id', ids)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, deleted: data?.length ?? 0 })
}
