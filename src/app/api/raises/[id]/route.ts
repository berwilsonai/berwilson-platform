import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { parseRaiseFields, type RaiseBody } from '@/lib/investors/raises'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: RaiseBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Partial updates need the name present for the parser — fill it from the
  // existing row when the caller didn't send one (e.g. a status-only change).
  const supabase = createAdminClient()
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    const { data: existing } = await supabase.from('raises').select('name').eq('id', id).maybeSingle()
    if (!existing) return Response.json({ error: 'Raise not found' }, { status: 404 })
    body.name = existing.name
  }

  const result = parseRaiseFields(body)
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })

  // Only apply keys the caller actually sent (plus the name backfill above).
  // Target kind + project travel as a pair.
  const provided = new Set(Object.keys(body))
  const update: Partial<typeof result.fields> = {}
  for (const [key, value] of Object.entries(result.fields)) {
    if (provided.has(key)) (update as Record<string, unknown>)[key] = value
  }
  if (provided.has('target_kind')) update.project_id = result.fields.project_id
  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No fields provided' }, { status: 400 })
  }

  const { data, error } = await supabase.from('raises').update(update).eq('id', id).select().single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ raise: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson('Only admins can delete raises')

  const { id } = await params
  const supabase = createAdminClient()

  // investments.raise_id is ON DELETE SET NULL — the money records survive,
  // they just come untagged from the raise.
  const { error } = await supabase.from('raises').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
