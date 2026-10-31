/**
 * The ramp-up schedule, and the one number the platform shows for it.
 *
 * Richard, 2026-10-30: *"put a 'ramp up schedule' that is where you allow it to
 * add up to 6 phases of Megawatt power with a date. For example, 100 MW by June
 * 1 2027, 300 MW by August 2029. Total 400 MW. I want that total of MW displayed
 * on every project in a prominent place. It is the key metric."*
 *
 * ── THIS FILE IS DELIBERATELY SHAPED LIKE `pipeline-value.ts` ───────────────
 * That module exists because `estimated_value` was a single unlabelled numeric
 * column holding $57.5B of plainly different quantities, and nothing on screen
 * said which quantity it was. Megawatts arrive with the same hazard and one
 * more: a phase figure can be read as an INCREMENT or as a RUNNING TOTAL, and
 * the two are indistinguishable once typed. So, exactly as with money:
 *
 *   - every figure comes back with a `definition` the caller is expected to show
 *   - nothing reads `power_phases` and adds it up for itself
 *   - the hierarchy arithmetic lives here, once
 *
 * ⚠ INCREMENTS, NOT A CUMULATIVE CURVE. Richard's own example is the
 * definition: 100 MW by Jun 2027 + 300 MW by Aug 2029 = **400 MW**. Under a
 * cumulative reading that total would be 300. `cumulativeRamp()` below exists so
 * the editor can SHOW the running total while storing the increments, which is
 * what stops the next person re-deciding this silently.
 *
 * ⚠ ALWAYS MW, NEVER GW. 1,200 MW is rendered "1,200 MW" and not "1.2 GW",
 * because a column read down the page has to be comparable and §12 is blunt
 * about it: one quantity, one definition, or the reader trusts none of them.
 * Two adjacent rows reading "900 MW" and "1.2 GW" make the reader do unit
 * arithmetic to answer "which is bigger", which is the whole job of the column.
 *
 * ⚠ THE FORMATTER LIVES HERE AND NOT IN `constants.ts`, which is where
 * `formatValue`/`formatMoney` live. The rule §12 actually states is ONE home per
 * quantity and no local copies — there were five copies of the money formatter.
 * This module owns megawatts end to end: the parse, the sum, the hierarchy and
 * the rendering. Anything that prints MW imports `formatMegawatts` from here.
 *
 * Pure apart from the hierarchy helpers, which are IMPORTED from
 * `pipeline-value.ts` rather than copied — §12: never fork a shared pass. A
 * program double-counting megawatts is the same bug as a program
 * double-counting money, and it must not be possible to fix one and not the
 * other.
 */

import { descendantsOf, leafRecords, type HierarchyRecord } from './pipeline-value'

/**
 * One tranche, as it comes off `power_phases`.
 *
 * `megawatts` is typed loosely because PostgREST hands a `numeric` column back
 * as a STRING, and the version of this that assumed `number` would have summed
 * "100" + "300" to "100300". Everything goes through `num()`.
 */
export interface PowerPhase {
  phase_no: number
  megawatts: number | string | null
  target_date?: string | null
  label?: string | null
  note?: string | null
}

/** The widest the schema allows. The editor and the schema agree on six. */
export const MAX_POWER_PHASES = 6

/**
 * ⚠ AN EMPTY OR BLANK STRING IS ABSENT, NOT 0 — `Number('')` is 0, and a blank
 * megawatt figure rendered as "0 MW" is a fact about the deal that nobody
 * typed. Lifted deliberately from `pipeline-value.ts`'s `num`, which carries
 * the same comment for the same reason; the two are four lines and inlining
 * beats exporting a private helper across a module boundary.
 */
function num(value: number | string | null | undefined): number | null {
  if (value == null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export interface PowerTotal {
  /**
   * Total megawatts across every phase, or NULL when the deal has no ramp
   * schedule at all.
   *
   * ⚠ NULL, NEVER 0. A deal with no schedule and a deal whose schedule sums to
   * nothing are different states, and "0 MW" states a fact nobody made (§12,
   * and the same trap `pipeline-value.ts` documents for an unpriced program).
   * The schema forbids a 0 MW phase, so a non-null total is always positive.
   */
  megawatts: number | null
  /** How many phases are on the schedule. */
  phases: number
  /** How many of those carry a target date. */
  dated: number
  /** Earliest target date present (ISO), or null. */
  firstDate: string | null
  /** Latest target date present (ISO) — when the deal is fully ramped. */
  lastDate: string | null
  /** Shown to the reader. Never omit it: an unlabelled figure is the old bug. */
  definition: string
  /** Longer form, for a tooltip or a tile's second line. */
  hint: string
}

const NO_POWER: PowerTotal = {
  megawatts: null,
  phases: 0,
  dated: 0,
  firstDate: null,
  lastDate: null,
  definition: 'No ramp schedule',
  hint: 'nobody has entered a power ramp-up schedule for this deal',
}

/** Phase order: by number, which is what the schema's unique key is on. */
export function sortPhases<T extends PowerPhase>(phases: readonly T[]): T[] {
  return [...phases].sort((a, b) => a.phase_no - b.phase_no)
}

/**
 * The deal's total power, and what that total IS.
 *
 * ⚠ A PHASE WITH NO DATE STILL COUNTS. Capacity is routinely known before the
 * date it lands, so `target_date` is nullable and the total is the sum of the
 * MEGAWATTS. `dated` comes back beside it so a caller can say "400 MW, 2 of 3
 * phases dated" rather than implying a schedule it does not have.
 */
export function powerTotal(phases: readonly PowerPhase[]): PowerTotal {
  let megawatts = 0
  let counted = 0
  let dated = 0
  let firstDate: string | null = null
  let lastDate: string | null = null

  for (const phase of phases) {
    const mw = num(phase.megawatts)
    if (mw == null) continue
    megawatts += mw
    counted += 1
    const date = phase.target_date ?? null
    if (!date) continue
    dated += 1
    if (firstDate == null || date < firstDate) firstDate = date
    if (lastDate == null || date > lastDate) lastDate = date
  }

  if (counted === 0) return NO_POWER

  const spread =
    dated === 0
      ? 'no dates set yet'
      : dated < counted
        ? `${dated} of ${counted} phases dated`
        : counted === 1
          ? 'a single phase'
          : `phased to ${lastDate}`

  return {
    megawatts,
    phases: counted,
    dated,
    firstDate,
    lastDate,
    definition: 'Total ramp-up capacity',
    hint: `the sum of ${counted} ramp phase${counted === 1 ? '' : 's'} entered by hand on this record — ${spread}`,
  }
}

/**
 * The running total at each phase — what the deal is actually carrying once
 * that tranche is live.
 *
 * ⚠ THIS IS THE READOUT THAT KEEPS THE INCREMENT/CUMULATIVE QUESTION ANSWERED.
 * The editor shows "100 MW → 400 MW cumulative" beside the two rows Richard
 * described, so somebody typing 300 into phase 2 can see immediately whether
 * the platform read them as adding 300 or as topping out at 300. A stored
 * cumulative figure would have made the total wrong and nothing would have
 * said so.
 */
export interface RampStep {
  phase: PowerPhase
  /** This phase's own increment. */
  megawatts: number
  /** Everything online once this phase lands. */
  cumulative: number
}

export function cumulativeRamp(phases: readonly PowerPhase[]): RampStep[] {
  let running = 0
  const out: RampStep[] = []
  for (const phase of sortPhases(phases)) {
    const mw = num(phase.megawatts)
    if (mw == null) continue
    running += mw
    out.push({ phase, megawatts: mw, cumulative: running })
  }
  return out
}

/**
 * The next tranche still to land, relative to `now`.
 *
 * Returns null when every dated phase is in the past (fully ramped, or at least
 * scheduled to be) or when nothing carries a date at all. A caller showing this
 * must not present "nothing next" as "finished" — the two are different and
 * only the schedule's own dates are evidence either way.
 */
export function nextPhase<T extends PowerPhase>(
  phases: readonly T[],
  now: Date = new Date()
): T | null {
  // Compared as ISO day strings, never as Date objects. `target_date` is a
  // DATE column, so parsing it to a Date lands it at UTC midnight and anyone
  // west of UTC sees the previous day — the same bug §12 records against the
  // nine copies of the date formatter.
  const today = toISODay(now)
  let best: T | null = null
  for (const phase of phases) {
    const date = phase.target_date ?? null
    if (!date || date < today) continue
    if (best == null || date < (best.target_date ?? '')) best = phase
  }
  return best
}

function toISODay(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * The one way megawatts are printed.
 *
 * Thousands separated, decimals only when the figure actually has them — a
 * behind-the-meter tranche is genuinely 12.5 MW, and a round four hundred is
 * "400 MW" and not "400.0 MW". Never abbreviated to GW; see the file header.
 */
export function formatMegawatts(
  megawatts: number | null | undefined,
  opts: { unit?: boolean } = {}
): string {
  const value = num(megawatts)
  if (value == null) return '—'
  const unit = opts.unit === false ? '' : ' MW'
  // One decimal at most, and never a trailing `.0`.
  const rounded = Math.round(value * 10) / 10
  const text = Number.isInteger(rounded)
    ? rounded.toLocaleString('en-US')
    : rounded.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${text}${unit}`
}

// ─────────────────────────────────────────────────────────────────────────────
// HIERARCHY. A program and its sites are not two deals' worth of power.
// ─────────────────────────────────────────────────────────────────────────────

/** How a caller hands over the phases belonging to one record. */
export type PhaseLookup = (recordId: string) => readonly PowerPhase[]

/** Build a `PhaseLookup` from rows read straight out of `power_phases`. */
export function phaseLookup(
  rows: readonly (PowerPhase & { project_id?: string | null; opportunity_id?: string | null })[]
): PhaseLookup {
  const byRecord = new Map<string, PowerPhase[]>()
  for (const row of rows) {
    // ⚠ NEVER ASSUME `project_id` IS SET (§4 shared children). An opportunity's
    // phases carry `opportunity_id` and a null `project_id`, and the version of
    // this that keyed on `project_id` alone would have silently dropped every
    // phase on the opportunity half of the pipeline — which is where several of
    // the power deals actually live.
    const id = row.project_id ?? row.opportunity_id
    if (!id) continue
    const list = byRecord.get(id)
    if (list) list.push(row)
    else byRecord.set(id, [row])
  }
  return (recordId) => byRecord.get(recordId) ?? []
}

export interface SubtreePower extends PowerTotal {
  /** True when this figure is the sum of sub-projects rather than the record's own. */
  rolled: boolean
  /** How many leaves contributed. 0 when the record answered for itself. */
  leaves: number
  /**
   * The record's OWN schedule when it has one and is being rolled up anyway.
   * Reported rather than dropped: ignoring a number and saying you ignored it
   * are different acts (§12).
   */
  ownTotal: PowerTotal | null
}

/**
 * One record's power, rolled up from its sub-projects when it has any.
 *
 * THE RULE, the same one `pipeline-value.ts` applies to money: A DEAL'S
 * CAPACITY LIVES ON LEAVES. A program's figure is what the sites inside it add
 * up to, never its own figure as well — a program carrying 900 MW beside three
 * sites carrying 300 each is 1,800 MW in any portfolio total, and that is a
 * number nobody can defend. A parent with no children is a leaf, so the
 * behaviour only changes for a record that actually contains others.
 *
 * ⚠ ONE DELIBERATE DIVERGENCE FROM THE MONEY RULE, AND IT IS NOT A DOUBLE
 * COUNT. Where the leaves carry NO schedule at all, the parent's own schedule
 * is used. For money `rolledPipelineValue` returns null there and says the
 * program is unpriced, which is right for a figure somebody is about to type;
 * for power it would hide a real, entered 400 MW behind three empty
 * sub-projects. The leaves contribute zero in that case, so nothing is counted
 * twice. ⚠ AND `portfolioPower` BELOW APPLIES THE IDENTICAL FALLBACK, because
 * two surfaces disagreeing about one quantity is the bug §12 opens with — a
 * program page reading 400 MW above a portfolio tile reading 0 is worse than
 * either number alone.
 */
export function subtreePower<T extends HierarchyRecord>(
  record: T,
  records: readonly T[],
  phasesOf: PhaseLookup
): SubtreePower {
  const own = powerTotal(phasesOf(record.id))
  const leaves = leafRecords([record, ...descendantsOf(record.id, records)])
  const isLeaf = leaves.length === 1 && leaves[0]?.id === record.id

  if (isLeaf) {
    return { ...own, rolled: false, leaves: 0, ownTotal: null }
  }

  const fromLeaves = powerTotal(leaves.flatMap((leaf) => [...phasesOf(leaf.id)]))

  // The leaves declare nothing — the parent answers for the subtree. See the
  // ⚠ above: this is a fallback, not a roll-up, so it does not claim to be one.
  if (fromLeaves.megawatts == null) {
    return {
      ...own,
      rolled: false,
      leaves: 0,
      ownTotal: null,
      hint:
        own.megawatts == null
          ? `neither this program nor its ${leaves.length} sub-projects has a ramp schedule`
          : `${own.hint}; its ${leaves.length} sub-projects carry no schedule of their own`,
    }
  }

  return {
    ...fromLeaves,
    definition: `Rolled up from ${leaves.length} sub-project${leaves.length === 1 ? '' : 's'}`,
    hint: `the capacity of the work inside — ${fromLeaves.hint.replace(/^the sum of /, '')}`,
    rolled: true,
    leaves: leaves.length,
    ownTotal: own.megawatts == null ? null : own,
  }
}

export interface PortfolioPower {
  /** Total MW across the set, each deal counted once. */
  megawatts: number
  /** How many records contributed a figure. */
  withSchedule: number
  /** How many contributed nothing. */
  without: number
  /** How many were held out as containers of others. */
  rolledUp: number
}

/**
 * The total for a SET of records — the masthead tile, a stage column, the whole
 * portfolio — counting each deal once.
 *
 * ⚠ IT WALKS SUBTREES FROM THE ROOTS RATHER THAN FILTERING TO LEAVES, so that
 * it agrees with `subtreePower` BY CONSTRUCTION including in the fallback case
 * above. A leaf-filtering version would total 0 over a program that declares
 * 400 MW above three empty sites, while the program's own page read 400 — one
 * quantity with two definitions, which is the failure this whole module is
 * shaped to prevent.
 *
 * ⚠ "PRESENT IN THE SAME SET" IS LOAD-BEARING, exactly as it is for money. A
 * root here means a record whose parent is not in this set — not a record with
 * no `parent_project_id` — because `dropHidden` (confidential projects) and
 * every URL filter produce sets holding a child whose parent was removed. Were
 * roots judged by the column alone, such a child would vanish from its own
 * total.
 */
export function portfolioPower<T extends HierarchyRecord>(
  records: readonly T[],
  phasesOf: PhaseLookup
): PortfolioPower {
  const present = new Set(records.map((record) => record.id))
  const roots = records.filter(
    (record) => !record.parent_project_id || !present.has(record.parent_project_id)
  )

  let megawatts = 0
  let withSchedule = 0
  let without = 0

  for (const root of roots) {
    const total = subtreePower(root, records, phasesOf)
    if (total.megawatts == null) {
      without += 1
      continue
    }
    megawatts += total.megawatts
    withSchedule += 1
  }

  return { megawatts, withSchedule, without, rolledUp: records.length - roots.length }
}

/**
 * A short sentence naming how much of a set the total actually covers, or null
 * when every record contributed. Mirrors `coverageNote` for money.
 */
export function powerCoverageNote(total: PortfolioPower): string | null {
  if (total.without === 0) return null
  const all = total.withSchedule + total.without
  if (total.withSchedule === 0) return `none of ${all} scheduled`
  return `${total.withSchedule} of ${all} scheduled`
}
