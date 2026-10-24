import { NextRequest, NextResponse } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import { embedPartyNote, removePartyNoteChunks } from '@/lib/ai/embeddings'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string; noteId: string }>
}

/**
 * Edit or delete one entry on a contact's feed.
 *
 * ⚠ CREATING ONE IS NOT HERE — it goes through `/api/updates/save`, the one
 * door `logEntry` serves for every record kind (§12: never fork a shared pass,
 * add a target). Only editing and deleting live here, because a note is
 * identified by its own id and there is no shared pass for "change this row".
 *
 * ⚠ NOT IN `src/lib/records/children.ts`, AND THAT IS A JUDGEMENT RATHER THAN
 * AN OVERSIGHT. That registry is the choke point for tables hanging off a
 * PROJECT OR AN OPPORTUNITY — its `ParentShape` is exactly that pair, and the
 * access check it centralises is `canAccessRecord`, which answers a question
 * about a deal. A contact has no such gate: the directory is readable and
 * editable by every signed-in user and the auth boundary is the middleware
 * (§8). Adding a third parent shape to a module that IS a security boundary, to
 * carry one table that needs none of its machinery, would make that boundary
 * harder to read for no gain.
 *
 * ⚠ `actorAdminClient()`, not `createAdminClient()`. `party_notes` carries
 * `log_activity()` from the migration that created it, and §12: making a table
 * tracked means auditing every write path to it in the SAME change, or the trail
 * reads "system" and answers nothing — which is the only question an audit trail
 * was added to answer.
 *
 * ⚠ THE PARTY ID IN THE PATH IS CHECKED AGAINST THE ROW, not trusted. §12: a
 * one-table CRUD route is where the record check goes missing, and a PATCH
 * carries only an id — so without this, a note on one contact could be edited
 * through another contact's URL, and `party_id` itself is deliberately absent
 * from what a body may set, or a request could re-parent the row.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id, noteId } = await params
  const supabase = await actorAdminClient()

  const { data: existing } = await supabase
    .from('party_notes')
    .select('id, party_id')
    .eq('id', noteId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Note not found' }, { status: 404 })
  if (existing.party_id !== id) {
    return NextResponse.json({ error: 'That note is on a different contact' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ⚠ A WHITELIST, AND A FIELD THE CALLER NEVER MENTIONED IS OMITTED RATHER
  // THAN NULLED (§12) — an explicit NULL does not fall back to the column
  // default, and `financing/[id]` blanked whole rows this way before the child
  // registry fixed it.
  const patch: TablesUpdate<'party_notes'> = {}
  if (typeof body.body === 'string' && body.body.trim()) patch.body = body.body.trim()
  if (typeof body.summary === 'string') patch.summary = body.summary.trim() || null
  if (typeof body.note_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.note_date)) {
    patch.note_date = body.note_date
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  }

  const { error } = await supabase.from('party_notes').update(patch).eq('id', noteId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Re-index only when the words changed. A date correction is not a new fact
  // about the conversation, and re-embedding costs a contended local GPU pass.
  if (patch.body) embedPartyNote(noteId, id, patch.body).catch(console.error)

  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id, noteId } = await params
  const supabase = await actorAdminClient()

  const { data: existing } = await supabase
    .from('party_notes')
    .select('id, party_id')
    .eq('id', noteId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Note not found' }, { status: 404 })
  if (existing.party_id !== id) {
    return NextResponse.json({ error: 'That note is on a different contact' }, { status: 404 })
  }

  const { error } = await supabase.from('party_notes').delete().eq('id', noteId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ⚠ THE ROW IS RECOVERABLE AND THE INDEX IS NOT, so the chunks go. §4: a
  // DELETE survives itself, because `log_activity()` writes `to_jsonb(old)` into
  // `metadata` — the text is in the append-only log. A passage left in `chunks`
  // after its row is gone is the opposite: it keeps answering questions as if
  // the note still stood, with nothing to open.
  removePartyNoteChunks(noteId, id).catch(console.error)

  return NextResponse.json({ ok: true })
}
