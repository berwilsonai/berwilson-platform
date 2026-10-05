/**
 * `computeDealEconomics` is the one entry point.
 *
 * ⚠ THE DEAL TAB, THE SCRATCHPAD, THE API ROUTE AND THE AGENT TOOLS ALL CALL
 * THIS FUNCTION. A shared engine wired to one surface is worse than no shared
 * engine (CLAUDE.md, 09-26), and two copies of a formula drift the moment one
 * is fixed. If a number appears anywhere in the platform, it came from here.
 *
 * ⚠ AND A MISSING INPUT IS NOT A WARNING. `missing` is "nobody has said yet",
 * `warnings` is "this looks wrong but is arithmetic", `errors` is "this cannot
 * be believed". Only the third makes `valid` false.
 *
 * Pure, no imports beyond sibling modules. Safe for a verification script.
 */

import {
  computeCaptureTiers,
  computeEntityRollups,
  type CaptureTiers,
  type EntityRollup,
} from './capture'
import { buildLedger, type LedgerResult } from './ledger'
import { evaluateLines, type LineResult } from './lines'
import { weakestStatus, type ProvenanceStatus } from './provenance'
import type { DealEconomicsInput } from './types'
import {
  collectErrors,
  collectWarnings,
  type EconomicsError,
  type EconomicsWarning,
} from './warnings'

export interface MissingInput {
  lineId: string | null
  lineLabel: string | null
  /** What is absent, phrased as the thing to go and find out. */
  what: string
}

export interface DealEconomicsResult {
  /** False when anything in `errors` is present. Nothing else blocks. */
  valid: boolean
  ledger: LedgerResult
  lines: LineResult[]
  tiers: CaptureTiers
  byEntity: EntityRollup[]
  warnings: EconomicsWarning[]
  errors: EconomicsError[]
  missing: MissingInput[]
  /**
   * The weakest provenance anywhere in the model. Every headline figure
   * inherits it, so a deal resting on one planning assumption reads as a
   * planning number however much of the rest is contracted.
   */
  status: ProvenanceStatus | null
}

export function computeDealEconomics(
  input: DealEconomicsInput,
  options: { now?: Date } = {}
): DealEconomicsResult {
  const { results, draws, cycleLineIds } = evaluateLines(input)
  const ledger = buildLedger(input.sources, input.buckets, draws)
  const tiers = computeCaptureTiers(results, input.spvs, input.capRatePct, ledger.firmMw)
  const byEntity = computeEntityRollups(results, input.spvs, input.capRatePct)

  const collectArgs = { input, lines: results, ledger, tiers, cycleLineIds, now: options.now }
  const warnings = collectWarnings(collectArgs)
  const errors = collectErrors(collectArgs)

  const missing: MissingInput[] = []
  for (const line of results) {
    for (const what of line.missing) {
      missing.push({ lineId: line.lineId, lineLabel: line.label, what })
    }
  }
  for (const source of ledger.sources) {
    for (const what of source.missing) {
      missing.push({ lineId: null, lineLabel: source.label, what })
    }
  }
  if (input.discountRatePct == null && results.some((l) => l.shape === 'recurring')) {
    missing.push({ lineId: null, lineLabel: null, what: 'Deal discount rate, needed for NPV' })
  }
  if (input.capRatePct == null && results.some((l) => l.annualNoi != null)) {
    missing.push({
      lineId: null,
      lineLabel: null,
      what: 'Cap rate, needed for a stabilized asset value',
    })
  }

  return {
    valid: errors.length === 0,
    ledger,
    lines: results,
    tiers,
    byEntity,
    warnings,
    errors,
    missing,
    status: weakestStatus([ledger.status, ...results.map((l) => l.status)]),
  }
}

/**
 * An empty model, which is what a new deal and a fresh scratchpad both start
 * from. Every rate is null: there is no default price, load factor, discount
 * rate or cap rate anywhere in this engine, and an empty field shows as missing
 * rather than quietly carrying someone else's assumption into a new deal.
 */
export function emptyDealEconomics(): DealEconomicsInput {
  return {
    sources: [],
    buckets: [],
    lines: [],
    spvs: [],
    discountRatePct: null,
    capRatePct: null,
    baseYear: null,
    statedTotal: null,
  }
}
