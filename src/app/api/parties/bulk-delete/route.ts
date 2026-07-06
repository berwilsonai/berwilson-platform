import { NextRequest, NextResponse } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'

/**
 * POST /api/parties/bulk-delete — archive many contacts at once.
 * Body: { ids: string[] }. Same soft-delete semantics as the single
 * DELETE route: status flips to 'archived', data is preserved.
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
  const { data, error } = await supabase
    .from('parties')
    .update({ status: 'archived' })
    .in('id', ids)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, archived: data?.length ?? 0 })
}
