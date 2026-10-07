/**
 * POST /api/spvs/standard — set up Land, Energy and Data Center on a deal.
 *
 * Richard's ask: every development site runs on these three, so every deal
 * should have the option of them in one press. They are created named after the
 * record, and only the ones that do not already exist.
 *
 * ⚠ IT CREATES NO `entities` ROW, DELIBERATELY. `entities.category` is
 * `vendor | partner | contractor` and that table drives the Vendors &
 * Contractors directory, so a row for an unformed SPV would put "Myton Land
 * LLC" in the vendor list as a company we buy from. Worse, it would assert a
 * legal entity exists when the usual case on a pursuit is that nothing has been
 * formed yet. `entity_id` and `org_node_id` stay null until there is something
 * real to point at, and linking them is a separate act.
 *
 * ⚠ AND NO OWNERSHIP SPLIT IS INVENTED. The financing partners' shares are not
 * decided, so no participant rows are created and `bw_ownership_pct` is left
 * null — the engine reports revenue in these vehicles as undetermined rather
 * than as wholly ours.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { scopeFromBody } from '@/lib/records/scope'
import { actorFrom, requireRecordAccess } from '@/lib/spvs/access'
import { explainSpvError } from '@/lib/spvs/collections'
import { spvDb, spvDbAs, type ProjectSpvRow } from '@/lib/spvs/db'
import { DEFAULT_SPV_PURPOSES, SPV_PURPOSE_NAMES } from '@/lib/spvs/types'

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  const scope = scopeFromBody(body)
  if (!scope) {
    return Response.json(
      { error: 'Exactly one of project_id or opportunity_id is required' },
      { status: 400 }
    )
  }

  const access = await requireRecordAccess(scope.kind, scope.id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  // The record's own name, so the vehicles read as this deal's. The client
  // sends it because it already has it; a blank falls back to a bare purpose
  // name rather than inventing one.
  const prefix = typeof body.prefix === 'string' ? body.prefix.trim() : ''
  const suffix = typeof body.suffix === 'string' && body.suffix.trim() ? body.suffix.trim() : 'LLC'

  // ⚠ `SPV_PURPOSE_NAMES`, NOT `SPV_PURPOSE_LABELS`. The label is sentence case
  // for a column heading ("Data center"); this string becomes the name of a
  // company, where "Myton Data center LLC" reads as a typo on every screen it
  // ever appears on afterwards.
  const nameFor = (purpose: (typeof DEFAULT_SPV_PURPOSES)[number]) =>
    prefix
      ? `${prefix} ${SPV_PURPOSE_NAMES[purpose]} ${suffix}`
      : `${SPV_PURPOSE_NAMES[purpose]} ${suffix}`

  const { data: existing, error: readError } = await spvDb()
    .from('project_spvs')
    .select('id,purpose,label')
    .eq(scope.column, scope.id)
  if (readError) {
    return Response.json({ error: explainSpvError(readError.message, readError.code) }, { status: 400 })
  }

  // ⚠ READ THE ROLL FIRST AND COUNT THE SKIPS. An insert that was safe only
  // because the record was brand new breaks the moment this can be pressed
  // twice, and `unique nulls not distinct (project_id, opportunity_id, label)`
  // would answer with a constraint violation rather than "you already have
  // these" (CLAUDE.md §12, 09-30).
  //
  // ⚠ AND IT DE-DUPES ON LABEL, NOT ON PURPOSE. The route this replaces skipped
  // any purpose already present, which made a SECOND energy vehicle
  // unreachable through it — and "could have more" is the stated requirement.
  // A deal can hold two energy SPVs; it cannot hold two with the same name,
  // which is exactly what the constraint says.
  const taken = new Set(
    ((existing ?? []) as Pick<ProjectSpvRow, 'label'>[]).map((s) => s.label)
  )
  const toCreate = DEFAULT_SPV_PURPOSES.filter((p) => !taken.has(nameFor(p)))

  if (toCreate.length === 0) {
    return Response.json({
      created: 0,
      skipped: DEFAULT_SPV_PURPOSES.length,
      spvs: [],
    })
  }

  // The highest existing sort_order, so a second press appends rather than
  // colliding with the order of what is already there.
  const base = (existing ?? []).length

  // One statement, one uniform column list: a row omitting a column gets an
  // explicit NULL and not its default (CLAUDE.md §12, 09-15).
  const rows = toCreate.map((purpose, index) => ({
    [scope.column]: scope.id,
    label: nameFor(purpose),
    purpose,
    entity_id: null,
    org_node_id: null,
    org_node_name: null,
    jurisdiction: null,
    bw_ownership_pct: null,
    raise_target: null,
    status: 'planning_assumption',
    note: null,
    sort_order: base + index + 1,
  }))

  const { data, error } = await spvDbAs(actorFrom(access.viewer))
    .from('project_spvs')
    .insert(rows)
    .select('id,label,purpose')

  if (error) {
    return Response.json({ error: explainSpvError(error.message, error.code) }, { status: 400 })
  }

  return Response.json({
    created: rows.length,
    skipped: DEFAULT_SPV_PURPOSES.length - rows.length,
    spvs: data ?? [],
  })
}
