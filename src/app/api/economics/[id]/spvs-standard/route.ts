/**
 * POST /api/economics/[id]/spvs-standard — set up Land, Energy and Data Center.
 *
 * Richard's ask: every project should have the OPTION of these three. They are
 * created named after the record, and only the ones that do not already exist.
 *
 * ⚠ IT CREATES NO `entities` ROW, DELIBERATELY, AND THE PLAN SAID IT WOULD.
 * `entities.category` is `vendor | partner | contractor` and that table drives
 * the Vendors & Contractors directory, so a row for an unformed SPV would put
 * "Helper Land LLC" in the vendor list as a company we buy from. Worse, it
 * would assert a legal entity exists when the usual case on a pursuit is that
 * nothing has been formed yet. `economics_spvs.entity_id` stays null until
 * there is a real entity to point at, and linking the two is a separate act
 * once the LLC actually exists.
 *
 * ⚠ AND NO OWNERSHIP SPLIT IS INVENTED. The financing partners' share is not
 * decided, so `bw_ownership_pct` is left null and the engine reports revenue in
 * these vehicles as undetermined rather than as wholly ours.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { actorFrom, requireEconomicsAccess } from '@/lib/economics/access'
import { calcDb, calcDbAs, type SpvRow } from '@/lib/economics/db'
import { explainEconomicsError } from '@/lib/economics/collections'
import { DEFAULT_SPV_PURPOSES, SPV_PURPOSE_LABELS } from '@/lib/economics'

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  // The record's own name, so the SPVs read as this deal's. The client sends
  // it because it already has it; a blank falls back to a bare purpose name
  // rather than inventing one.
  const prefix = typeof body.prefix === 'string' ? body.prefix.trim() : ''
  const suffix = typeof body.suffix === 'string' && body.suffix.trim() ? body.suffix.trim() : 'LLC'

  const { data: existing, error: readError } = await calcDb()
    .from('economics_spvs')
    .select('id,purpose,label')
    .eq('economics_id', id)
  if (readError) {
    return Response.json({ error: readError.message }, { status: 400 })
  }

  // ⚠ READ THE ROLL FIRST AND COUNT THE SKIPS. An insert that was safe only
  // because the model was brand new breaks the moment this can be pressed
  // twice, and `unique (economics_id, label)` would answer with a constraint
  // violation rather than "you already have these" (CLAUDE.md §12, 09-30).
  const taken = new Set(((existing ?? []) as Pick<SpvRow, 'purpose'>[]).map((s) => s.purpose))
  const toCreate = DEFAULT_SPV_PURPOSES.filter((p) => !taken.has(p))

  if (toCreate.length === 0) {
    return Response.json({ created: 0, skipped: DEFAULT_SPV_PURPOSES.length, spvs: [] })
  }

  // One statement, one uniform column list: a row omitting a column gets an
  // explicit NULL and not its default (CLAUDE.md §12, 09-15).
  const rows = toCreate.map((purpose, index) => ({
    economics_id: id,
    label: prefix
      ? `${prefix} ${SPV_PURPOSE_LABELS[purpose]} ${suffix}`
      : `${SPV_PURPOSE_LABELS[purpose]} ${suffix}`,
    purpose,
    entity_id: null,
    bw_ownership_pct: null,
    status: 'planning_assumption',
    sort_order: index + 1,
  }))

  const { data, error } = await calcDbAs(actorFrom(access.viewer))
    .from('economics_spvs')
    .insert(rows)
    .select('id,label,purpose')

  if (error) {
    return Response.json({ error: explainEconomicsError(error.message, error.code) }, { status: 400 })
  }

  return Response.json({
    created: rows.length,
    skipped: DEFAULT_SPV_PURPOSES.length - rows.length,
    spvs: data ?? [],
  })
}
