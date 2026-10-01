import { NextRequest, NextResponse } from 'next/server'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { govDb, govDbAs } from '@/lib/governance/db'
import { explainDbError } from '@/lib/governance/registers'
import { applySeparation } from '@/lib/governance/separation'
import type { PersonnelRow } from '@/lib/governance/db'

/**
 * PATCH / DELETE one employment record.
 *
 * A SEPARATION IS A PASS, NOT A COLUMN WRITE. Recording one also:
 *
 *   1. seeds the offboarding checklist, if it has none yet;
 *   2. CLOSES every open signature-authority row for that person;
 *   3. deactivates their platform login and snapshots what it could see;
 *   4. marks their box on the org chart departed rather than deleting it;
 *   5. reports each of those in `applied`, by count.
 *
 * ⚠ (2) IS THE ONE THAT MATTERS AND IS THE ONE THAT WOULD BE FORGOTTEN. An
 * officer's signing authority that outlives their employment is a live exposure
 * on a construction job, and nothing else in the system would ever close it.
 *
 * ⚠ EVERY ONE OF THOSE IS A FILL, NEVER AN OVERWRITE (§12, 09-30). Filling a
 * blank and overwriting a value are different acts and only one is safe to
 * automate: `effective_to` is written only where it is NULL, `deactivated_at`
 * only where it is NULL, and the offboarding checklist is seeded only when the
 * person has no rows. Nothing is renamed, nothing already decided is revised,
 * and `applied` names what moved so the pass can be trusted twice.
 *
 * Reinstating (clearing the separation) deliberately does NOT undo any of it.
 * An office is regained by appointment, with a resolution behind it — not by
 * editing a date — and the checklist is history.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const SEPARATION_TYPES = [
  'resigned',
  'terminated_cause',
  'terminated_without_cause',
  'layoff',
  'contract_end',
  'retired',
  'mutual',
  'deceased',
  'other',
]

const CLASSIFICATIONS = [
  'employee',
  'contractor_1099',
  'seconded',
  'temp',
  'intern',
  'officer_only',
  'board_only',
]

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const db = govDb()
  const writer = govDbAs({ id: viewer.authUserId, email: viewer.email })
  const actor = viewer.teamMemberName ?? viewer.email ?? null

  const { data: existingRaw, error: readError } = await db
    .from('personnel')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  const existing = existingRaw as PersonnelRow | null
  if (!existing) return NextResponse.json({ error: 'That personnel record no longer exists.' }, { status: 404 })

  const update: Record<string, unknown> = {}

  const str = (key: string) => {
    if (!(key in body)) return
    const raw = body[key]
    update[key] = typeof raw === 'string' && raw.trim() ? raw.trim() : null
  }
  const dateField = (key: string): string | null => {
    if (!(key in body)) return null
    const raw = body[key]
    if (raw === null || raw === '' || raw === undefined) {
      update[key] = null
      return null
    }
    if (typeof raw !== 'string' || !DATE_RE.test(raw.trim())) return `${key} must be YYYY-MM-DD`
    update[key] = raw.trim()
    return null
  }

  if ('full_name' in body) {
    const name = typeof body.full_name === 'string' ? body.full_name.trim() : ''
    if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 })
    update.full_name = name
  }
  str('title')
  str('legal_hold_reason')

  if ('classification' in body) {
    const c = typeof body.classification === 'string' ? body.classification : ''
    if (!CLASSIFICATIONS.includes(c)) {
      return NextResponse.json({ error: 'Unrecognised employment classification.' }, { status: 400 })
    }
    update.classification = c
  }

  for (const key of ['engaged_on', 'separated_on', 'separation_notice_on', 'retention_until']) {
    const err = dateField(key)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }

  if ('separation_type' in body) {
    const t = body.separation_type
    if (t === null || t === '') update.separation_type = null
    else if (typeof t !== 'string' || !SEPARATION_TYPES.includes(t)) {
      return NextResponse.json({ error: 'Unrecognised separation type.' }, { status: 400 })
    } else update.separation_type = t
  }

  if ('rehire_eligible' in body) {
    // Tri-state on purpose: null means nobody has decided, which is a different
    // answer from "no" and the one a reference request turns on.
    const r = body.rehire_eligible
    update.rehire_eligible = r === null || r === '' ? null : r === true || r === 'true'
  }

  if ('legal_hold' in body) {
    update.legal_hold = body.legal_hold === true || body.legal_hold === 'true'
    if (!update.legal_hold && !('legal_hold_reason' in body)) update.legal_hold_reason = null
  }

  if ('employing_entity_id' in body) {
    const entityId = typeof body.employing_entity_id === 'string' ? body.employing_entity_id : null
    update.employing_entity_id = entityId || null
    if (entityId) {
      const { data: node } = await db.from('org_nodes').select('name').eq('id', entityId).maybeSingle()
      update.employing_entity_name = (node as { name?: string } | null)?.name ?? null
    } else {
      update.employing_entity_name = null
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
  }

  const { data: savedRaw, error } = await writer
    .from('personnel')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: explainDbError(error.message, error.code) }, { status: 400 })
  }
  const saved = savedRaw as PersonnelRow

  // ── The separation pass ────────────────────────────────────────────────────
  // Lives in src/lib/governance/separation.ts so a verification script can run
  // it; see the header there for why every step fills rather than overwrites.

  const applied: string[] = []
  if (!existing.separated_on && saved.separated_on) {
    const result = await applySeparation(db, writer, saved, actor)
    applied.push(...result.applied)
    for (const problem of result.problems) console.error(`[governance] separation: ${problem}`)
  }

  return NextResponse.json({ row: saved, applied })
}

/**
 * DELETE — for a genuine mis-entry only.
 *
 * The real enforcement is `personnel_delete_guard()` in the database, which
 * refuses while a legal hold or a retention date stands; this just turns its
 * RAISE into a 400 with the sentence intact. Note what happens even on success:
 * log_activity writes to_jsonb(old) into activity_log.metadata, and activity_log
 * has no UPDATE or DELETE policy — so the row survives its own deletion in an
 * append-only log.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const { id } = await params
  const { error } = await govDbAs({ id: viewer.authUserId, email: viewer.email })
    .from('personnel')
    .delete()
    .eq('id', id)

  if (error) {
    // The guard's own message names the hold and the reason — pass it through.
    return NextResponse.json({ error: explainDbError(error.message, error.code) }, { status: 400 })
  }
  return NextResponse.json({ deleted: true })
}
