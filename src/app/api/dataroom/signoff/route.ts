import { NextRequest, NextResponse } from 'next/server'
import { getViewer, actorAdminClient, canAccessProject } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import { sectionByKey, UNSORTED_SECTION } from '@/lib/drive/data-room'
import { readRoomStatus } from '@/lib/dataroom/status'
import { fingerprintDocuments } from '@/lib/dataroom/signoff'

/**
 * POST   /api/dataroom/signoff  { project_id | opportunity_id, section_key, note? }
 * DELETE /api/dataroom/signoff  { project_id | opportunity_id, section_key }
 *
 * Tick or un-tick one data-room section.
 *
 * Richard, 2026-10-30: *"Checking it off will mean a human adjudicated it and
 * verified that is the most accurate and up to date doc."* So the row records
 * WHO, WHEN, and a fingerprint of the document set they were looking at — the
 * fingerprint being what makes the tick go STALE rather than silently wrong when
 * the folder changes afterwards.
 *
 * ⚠ THE RECORD IS READ BEFORE THE WRITE, AND THAT IS THE WHOLE RISK IN A ROUTE
 * THIS SHAPE. §12, measured: of 61 route handlers touching one table with one
 * write verb, **22 had no record check at all**, six of them siblings of a
 * seventh that did — because the body carries only an id, so the parent has to
 * be fetched deliberately and that is precisely the step that gets skipped.
 * Here it buys three things: the record exists, this viewer may see it, and the
 * section key is one the template declares.
 *
 * ⚠ `actorAdminClient()` AND NOT THE PLAIN ONE. `data_room_signoffs` carries
 * `log_activity()`, and §12 is explicit that a trail whose every row reads
 * "system" answers nothing — which is the only question this table was added to
 * answer. The actor client is what puts a name on the sequence "Eric signed it,
 * Richard un-ticked it, Eric signed it again".
 */

interface Target {
  table: 'projects' | 'opportunities'
  column: 'project_id' | 'opportunity_id'
  kind: 'project' | 'opportunity'
  id: string
}

function targetFrom(body: Record<string, unknown>): Target | null {
  if (typeof body.project_id === 'string' && body.project_id) {
    return { table: 'projects', column: 'project_id', kind: 'project', id: body.project_id }
  }
  if (typeof body.opportunity_id === 'string' && body.opportunity_id) {
    return {
      table: 'opportunities',
      column: 'opportunity_id',
      kind: 'opportunity',
      id: body.opportunity_id,
    }
  }
  return null
}

/** The shared gate: a real record, a viewer who may see it, a real section. */
async function resolve(request: NextRequest): Promise<
  | { ok: true; target: Target; sectionKey: string; note: string | null; viewer: NonNullable<Awaited<ReturnType<typeof getViewer>>> }
  | { ok: false; response: NextResponse }
> {
  const viewer = await getViewer()
  if (!viewer) {
    return { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const target = targetFrom(body)
  if (!target) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'A project_id or an opportunity_id is required.' },
        { status: 400 }
      ),
    }
  }

  const sectionKey = typeof body.section_key === 'string' ? body.section_key.trim() : ''
  // ⚠ Refused BY NAME rather than stored and ignored. A key the template does
  // not declare would sit in the table reading as a sign-off on nothing, and
  // `00.0 — _Unsorted` is a holding pen by definition — there is nothing there
  // to adjudicate as complete and current.
  if (!sectionByKey(sectionKey) || sectionKey === UNSORTED_SECTION) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `"${sectionKey}" is not a data-room section that can be signed off.` },
        { status: 400 }
      ),
    }
  }

  const { data: record, error } = await createAdminClient()
    .from(target.table)
    .select('id')
    .eq('id', target.id)
    .maybeSingle()
  if (error) {
    return { ok: false, response: NextResponse.json({ error: error.message }, { status: 500 }) }
  }
  // 404 rather than 403 — do not confirm the record exists to somebody who may
  // not see it, matching the project layout's own grant check.
  if (!record) {
    return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  if (target.kind === 'project' && !viewer.isAdmin && !(await canAccessProject(viewer, target.id))) {
    return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }

  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null
  return { ok: true, target, sectionKey, note, viewer }
}

export async function POST(request: NextRequest) {
  const gate = await resolve(request)
  if (!gate.ok) return gate.response
  const { target, sectionKey, note, viewer } = gate

  /**
   * ⚠ THE FINGERPRINT IS TAKEN FROM THE SAME READ EVERY OTHER SURFACE USES.
   * Computing it from a second, narrower query would let the sign-off describe
   * a set the Data room tab never showed — one quantity, two definitions, which
   * §12 has been bitten by three times. `readRoomStatus` already applies
   * `superseded_at is null` and `excluded_at is null`, so a retired or excluded
   * document is correctly not part of what was verified.
   */
  const status = await readRoomStatus(target.kind, target.id)
  if (!status) {
    return NextResponse.json(
      { error: 'This record is not on the data-room template.' },
      { status: 409 }
    )
  }
  const section = status.sections.find((s) => s.section.key === sectionKey)
  if (!section) {
    return NextResponse.json({ error: 'That section is not on this room.' }, { status: 400 })
  }

  const supabase = await actorAdminClient()
  const { data, error } = await supabase
    .from('data_room_signoffs')
    .upsert(
      {
        /*
          ⚠ BOTH PARENT COLUMNS WRITTEN EXPLICITLY, against the exactly-one
          CHECK — the same shape `composed_documents` uses. A computed key
          (`[target.column]: target.id`) collapses the object to a string index
          signature and the generated client rejects it, which is the typed
          client doing its job: it cannot verify a column chosen at run time.
        */
        project_id: target.kind === 'project' ? target.id : null,
        opportunity_id: target.kind === 'opportunity' ? target.id : null,
        section_key: sectionKey,
        signed_off_by: viewer.authUserId,
        // Snapshotted so "who verified this" keeps answering after a login is
        // renamed or removed. Falls back to the email, then to the uuid.
        signed_off_by_name: viewer.teamMemberName ?? viewer.email ?? viewer.authUserId,
        signed_off_at: new Date().toISOString(),
        document_count: section.documents.length,
        document_fingerprint: fingerprintDocuments(section.documents),
        note,
      },
      // ⚠ The conflict target is the `nulls not distinct` unique constraint, so
      // re-signing UPDATES the row rather than stacking a second one. Named by
      // COLUMNS, which is what PostgREST accepts — and it only works because
      // that constraint is `nulls not distinct`: under Postgres's default rule
      // the always-NULL parent column would make every re-sign look like a new
      // row and ON CONFLICT would never fire (§12).
      { onConflict: 'project_id,opportunity_id,section_key' }
    )
    .select('id, signed_off_by_name, signed_off_at, document_count')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    signed_off: true,
    by: data.signed_off_by_name,
    at: data.signed_off_at,
    document_count: data.document_count,
  })
}

export async function DELETE(request: NextRequest) {
  const gate = await resolve(request)
  if (!gate.ok) return gate.response
  const { target, sectionKey } = gate

  /*
    The row is deleted rather than flagged, and the history survives in
    `activity_log`: §4 — the trigger writes `to_jsonb(old)` into `metadata`, so
    a hard delete on a tracked table is recoverable and attributable. "Richard
    un-ticked 01.5 at 14:20" is a fact worth keeping and the log is where it
    lives; keeping a tombstone row here would instead make every reader filter
    for it.
  */
  const supabase = await actorAdminClient()
  const { error } = await supabase
    .from('data_room_signoffs')
    .delete()
    .eq(target.column, target.id)
    .eq('section_key', sectionKey)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ signed_off: false })
}
