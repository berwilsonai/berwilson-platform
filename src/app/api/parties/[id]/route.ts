import { NextRequest } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

const ALLOWED_FIELDS = [
  'full_name',
  'company',
  'title',
  'email',
  'phone',
  'relationship_notes',
  'linkedin_url',
  'avatar_url',
  'is_organization',
  'tags',
] as const

/*
 * ⚠ THE WRITES BELOW USE `actorAdminClient()`, NOT `createAdminClient()`, AND
 * THAT BECAME LOAD-BEARING ON 2026-10-20. §12: a user-initiated mutation on a
 * tracked table must carry its actor or `activity_log` records it as "system".
 * `parties` and `entities` gained `log_activity()` that day on Richard's call,
 * which meant auditing every write path to them: of the eight that mutate, FIVE
 * were on the plain client. An audit trail whose every row reads "system"
 * answers nothing — and these are exactly the rows Pepper also writes on her
 * own (§11, 10-15), so telling her edits from a human's is the whole point.
 *
 * The GET handlers in the sibling collection routes deliberately keep the plain
 * client: a read has no actor to record, and resolving the viewer there would
 * buy a cookie read and nothing else.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = await request.json()

  // Only allow known fields
  const updates: TablesUpdate<'parties'> = {}
  for (const key of ALLOWED_FIELDS) {
    if (key in body) {
      ;(updates as Record<string, unknown>)[key] = body[key]
    }
  }

  if ('tags' in updates) {
    if (!Array.isArray(updates.tags)) {
      return Response.json({ error: 'tags must be an array of strings' }, { status: 400 })
    }
    updates.tags = [...new Set(updates.tags.map(t => String(t).trim()).filter(Boolean))]
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const supabase = await actorAdminClient()

  const { data, error } = await supabase
    .from('parties')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ party: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const supabase = await actorAdminClient()

  // Soft-delete: archive so data is preserved but contact disappears from active lists
  const { error } = await supabase
    .from('parties')
    .update({ status: 'archived' })
    .eq('id', id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
