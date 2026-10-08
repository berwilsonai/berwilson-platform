/**
 * Set up Land, Energy and Data Center on a deal.
 *
 * ⚠ IN `src/lib` AND NOT IN THE ROUTE, BECAUSE A SETUP SCRIPT NEEDS IT TOO.
 * This was the body of `POST /api/spvs/standard`, which made it reachable only
 * over authenticated HTTP — so standing a deal's vehicles up from a script
 * meant re-writing the naming rule and the dedupe rule beside it. A forked copy
 * of a pass is how `runDocumentAiPass` silently discarded 413,000 characters
 * (CLAUDE.md §12, 09-17), and the same rule already says agent tools must never
 * fetch the app's own routes. One home, two callers.
 *
 * ⚠ IT CREATES NO `entities` ROW, DELIBERATELY. `entities.category` is
 * `vendor | partner | contractor` and that table drives the Vendors &
 * Contractors directory, so a row for an unformed SPV would put "Delta Land
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

import { RECORD_SCOPE_COLUMN, type RecordKind } from '@/lib/records/scope'
import { spvDb, spvDbAs, type ProjectSpvRow } from './db'
import { DEFAULT_SPV_PURPOSES, SPV_PURPOSE_NAMES } from './types'

export interface StandardVehiclesInput {
  kind: RecordKind
  recordId: string
  /**
   * The deal's own name, so the vehicles read as this deal's. A blank falls
   * back to a bare purpose name rather than inventing one.
   */
  prefix?: string
  /** Entity suffix. Defaults to `LLC`. */
  suffix?: string
  actor: { id: string; email?: string | null }
}

export interface StandardVehiclesResult {
  created: number
  skipped: number
  spvs: { id: string; label: string; purpose: string }[]
}

/** The name a vehicle gets, exported so a caller can report it before writing. */
export function standardVehicleName(
  purpose: (typeof DEFAULT_SPV_PURPOSES)[number],
  prefix: string,
  suffix = 'LLC'
): string {
  // ⚠ `SPV_PURPOSE_NAMES`, NOT `SPV_PURPOSE_LABELS`. The label is sentence case
  // for a column heading ("Data center"); this string becomes the name of a
  // company, where "Delta Data center LLC" reads as a typo on every screen and
  // signature block it ever reaches afterwards.
  const trimmed = prefix.trim()
  return trimmed
    ? `${trimmed} ${SPV_PURPOSE_NAMES[purpose]} ${suffix}`
    : `${SPV_PURPOSE_NAMES[purpose]} ${suffix}`
}

export async function createStandardVehicles(
  input: StandardVehiclesInput
): Promise<StandardVehiclesResult | { error: string }> {
  const column = RECORD_SCOPE_COLUMN[input.kind]
  const suffix = input.suffix?.trim() || 'LLC'
  const nameFor = (purpose: (typeof DEFAULT_SPV_PURPOSES)[number]) =>
    standardVehicleName(purpose, input.prefix ?? '', suffix)

  const { data: existing, error: readError } = await spvDb()
    .from('project_spvs')
    .select('id,purpose,label')
    .eq(column, input.recordId)
  if (readError) return { error: readError.message }

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
    return { created: 0, skipped: DEFAULT_SPV_PURPOSES.length, spvs: [] }
  }

  // The highest existing sort_order, so a second press appends rather than
  // colliding with the order of what is already there.
  const base = (existing ?? []).length

  // One statement, one uniform column list: a row omitting a column gets an
  // explicit NULL and not its default (CLAUDE.md §12, 09-15).
  const rows = toCreate.map((purpose, index) => ({
    [column]: input.recordId,
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

  const { data, error } = await spvDbAs(input.actor)
    .from('project_spvs')
    .insert(rows)
    .select('id,label,purpose')

  if (error) return { error: error.message }

  return {
    created: rows.length,
    skipped: DEFAULT_SPV_PURPOSES.length - rows.length,
    spvs: (data ?? []) as { id: string; label: string; purpose: string }[],
  }
}
