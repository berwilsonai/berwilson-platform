import { NextRequest, NextResponse } from 'next/server'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { govDb, govDbAs } from '@/lib/governance/db'
import { explainDbError, getRegister, normalizeRegisterPayload } from '@/lib/governance/registers'

/**
 * PATCH / DELETE one row of a governance register.
 *
 * Same guards and the same fixed register map as the collection route — see the
 * header there. The field whitelist is what stops a PATCH restamping a note's
 * author or writing the generated `status` column.
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ register: string; id: string }> }
) {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const { register, id } = await params
  const spec = getRegister(register)
  if (!spec) return NextResponse.json({ error: `Unknown register "${register}"` }, { status: 404 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const parsed = normalizeRegisterPayload(spec, body, { partial: true })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const value = parsed.value

  // Re-snapshot the related name when the link moved.
  if (spec.snapshots) {
    const db = govDb()
    for (const snap of spec.snapshots) {
      if (!(snap.from in value)) continue
      const linkId = value[snap.from]
      if (!linkId || typeof linkId !== 'string') {
        value[snap.into] = null
        continue
      }
      const { data } = await db.from(snap.table).select(snap.column).eq('id', linkId).maybeSingle()
      const name = (data as Record<string, unknown> | null)?.[snap.column]
      value[snap.into] = typeof name === 'string' ? name : null
    }
  }

  /**
   * Checking off an offboarding step stamps WHO did it and WHEN, here rather
   * than in the browser. A checklist whose completion time the client supplies
   * is not evidence of the thing it exists to evidence.
   */
  if (spec.table === 'personnel_offboarding' && 'completed_at' in body) {
    const done = body.completed_at !== null && body.completed_at !== false && body.completed_at !== ''
    value.completed_at = done ? new Date().toISOString() : null
    value.completed_by = done ? viewer.teamMemberName ?? viewer.email ?? null : null
  }

  const { data, error } = await govDbAs({ id: viewer.authUserId, email: viewer.email })
    .from(spec.table)
    .update(value)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: explainDbError(error.message, error.code) }, { status: 400 })
  }
  if (!data) return NextResponse.json({ error: `That ${spec.label} no longer exists.` }, { status: 404 })
  return NextResponse.json({ row: data })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ register: string; id: string }> }
) {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const { register, id } = await params
  const spec = getRegister(register)
  if (!spec) return NextResponse.json({ error: `Unknown register "${register}"` }, { status: 404 })

  /**
   * A note kind the platform's own passes write is not deletable, and neither is
   * one with notes under it — the FK carries no delete rule precisely so that a
   * category with history cannot be erased (§12). The UI offers `active: false`
   * instead, which keeps labelling the history while refusing new arrivals.
   */
  if (spec.table === 'personnel_note_kinds') {
    const { data: kind } = await govDb()
      .from('personnel_note_kinds')
      .select('system, key, label')
      .eq('id', id)
      .maybeSingle()
    const row = kind as { system?: boolean; label?: string } | null
    if (row?.system) {
      return NextResponse.json(
        { error: `"${row.label}" is a built-in note kind. Mark it inactive instead of deleting it.` },
        { status: 400 }
      )
    }
  }

  const { error } = await govDbAs({ id: viewer.authUserId, email: viewer.email })
    .from(spec.table)
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: explainDbError(error.message, error.code) }, { status: 400 })
  }
  return NextResponse.json({ deleted: true })
}
