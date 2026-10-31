/**
 * Reading `power_phases` — the server half of the ramp-up schedule.
 *
 * Kept apart from `power.ts` so that module stays pure and importable from a
 * client component, a test and a script without dragging the Supabase client
 * (and `next/headers` behind it) along. §12: `next/server` and `next/headers`
 * do not resolve under the verification-script loader AT ALL, so a top-level
 * import of either poisons the whole module, pure functions included.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { PowerPhaseRow } from '@/components/records/PowerRamp'
import {
  phaseLookup,
  powerTotal,
  sortPhases,
  subtreePower,
  type PhaseLookup,
  type SubtreePower,
} from '@/lib/records/power'
import { RECORD_SCOPE_COLUMN, type RecordKind } from '@/lib/records/scope'

/**
 * ⚠ THE ROW CAP AND THE URL CAP ARE TWO LIMITS ONE CONSTANT CANNOT SERVE (§12).
 * A filter rides in the query string, so `.in()` with a thousand uuids is a
 * 37KB GET that Kong refuses outright with `URI too long` — while PostgREST
 * separately truncates the RESULT at 1000 rows with no error at all. So ids are
 * chunked at 200 and the rows come back across several requests.
 *
 * At six phases per record this only bites past ~166 records, which the
 * portfolio is nowhere near. It is here because the alternative — a silent
 * truncation that reads as "those deals have no schedule" — is indistinguishable
 * from the truth on the one number Richard called the key metric.
 */
const ID_CHUNK = 200

const COLUMNS = 'id, project_id, opportunity_id, phase_no, megawatts, target_date, label, note'

/** A row as it comes back, carrying both parent columns so `phaseLookup` can key on either. */
export type PhaseRow = PowerPhaseRow & {
  project_id: string | null
  opportunity_id: string | null
}

/**
 * Every phase belonging to the given records, as a lookup keyed by record id.
 *
 * Pass the ids of the records on screen. Omitting them reads the whole table,
 * which is correct for a portfolio-wide tile and is what the masthead does.
 *
 * ⚠ A READ FAILURE RETURNS AN EMPTY LOOKUP AND SAYS SO IN THE LOG, rather than
 * throwing. A list page whose megawatt column is blank is a degraded page; a
 * list page that 500s because one decorative figure could not be read is a
 * broken one. The figure is prominent, not load-bearing for navigation.
 */
export async function readPhaseRows(recordIds?: readonly string[]): Promise<PhaseRow[]> {
  if (recordIds && recordIds.length === 0) return []

  const supabase = createAdminClient()
  const rows: PhaseRow[] = []

  async function take(ids: readonly string[] | null) {
    let query = supabase.from('power_phases').select(COLUMNS)
    if (ids) {
      // Either parent column may name the record — never assume `project_id`
      // (§4 shared children). An opportunity's phases carry a null project_id.
      const list = ids.join(',')
      query = query.or(`project_id.in.(${list}),opportunity_id.in.(${list})`)
    }
    const { data, error } = await query
    if (error) {
      console.error('[power-read] phase read failed:', error.message)
      return
    }
    rows.push(...((data ?? []) as unknown as PhaseRow[]))
  }

  if (!recordIds) {
    await take(null)
  } else {
    for (let at = 0; at < recordIds.length; at += ID_CHUNK) {
      await take(recordIds.slice(at, at + ID_CHUNK))
    }
  }

  return rows
}

/**
 * The same read, as the lookup the arithmetic takes.
 *
 * ⚠ A `PhaseLookup` IS A CLOSURE AND CANNOT CROSS THE SERVER/CLIENT BOUNDARY —
 * a server component may hand a client one plain data, never a function. So the
 * ROWS are the primitive and are what gets passed down; this wrapper exists for
 * the server-side callers (a masthead total, a header figure) that want the
 * lookup directly and would otherwise each write the same one-liner.
 */
export async function readPhaseLookup(recordIds?: readonly string[]): Promise<PhaseLookup> {
  return phaseLookup(await readPhaseRows(recordIds))
}

/** One record's schedule, in phase order, for its own page. */
export async function readRecordPhases(
  kind: RecordKind,
  recordId: string
): Promise<PowerPhaseRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('power_phases')
    .select(COLUMNS)
    .eq(RECORD_SCOPE_COLUMN[kind], recordId)

  if (error) {
    console.error('[power-read] record phase read failed:', error.message)
    return []
  }
  return sortPhases((data ?? []) as unknown as PowerPhaseRow[])
}

/**
 * ONE record's ramp-up total, rolled up from its sub-projects where it has any.
 *
 * ⚠ THIS EXISTS SO A RECORD'S OWN PAGE CANNOT DISAGREE WITH THE LIST IT CAME
 * FROM. `/projects` computes the figure with `subtreePower` over the whole
 * portfolio; a detail page that reached for `powerTotal(itsOwnPhases)` instead
 * would show a program its own 900 MW where the list showed its sites' 600 —
 * one quantity with two definitions, which §12 opens with. Putting the "which
 * set" decision here means there is one answer and both surfaces read it.
 *
 * ⚠ AN OPPORTUNITY IS ALWAYS A LEAF, and that is a fact about the schema, not
 * an optimisation: `opportunities` has no parent column. Reading the project
 * hierarchy for one would be a query that cannot change the answer, so it is
 * skipped and the reason is written down — the next person to add
 * `parent_opportunity_id` needs to find this branch.
 */
export async function readRecordPower(
  kind: RecordKind,
  recordId: string
): Promise<SubtreePower> {
  if (kind === 'opportunity') {
    const phases = await readRecordPhases('opportunity', recordId)
    return { ...powerTotal(phases), rolled: false, leaves: 0, ownTotal: null }
  }

  const supabase = createAdminClient()
  // Just the two columns the arithmetic needs. The whole hierarchy, because a
  // descendant two levels down still contributes and there is no cheaper way
  // to know who they are; `projects` is tens of rows, not thousands.
  const { data, error } = await supabase.from('projects').select('id, parent_project_id')
  if (error) {
    console.error('[power-read] hierarchy read failed:', error.message)
    const phases = await readRecordPhases('project', recordId)
    return { ...powerTotal(phases), rolled: false, leaves: 0, ownTotal: null }
  }

  const records = (data ?? []) as { id: string; parent_project_id: string | null }[]
  const self = records.find((record) => record.id === recordId) ?? {
    id: recordId,
    parent_project_id: null,
  }
  const phasesOf = await readPhaseLookup(records.map((record) => record.id))
  return subtreePower(self, records, phasesOf)
}
