/**
 * Sanity checks, and the line between a warning and a refusal.
 *
 * ⚠ A WARNING NEVER BLOCKS AND AN ERROR ALWAYS DOES, AND THE DIFFERENCE IS
 * WHETHER THE NUMBER CAN STILL BE BELIEVED. A $0.60/kWh price is improbable but
 * it is arithmetic anyone can check, so it warns. A milestone schedule totalling
 * 95% cannot be invoiced and allocations exceeding firm capacity sell the same
 * plant twice, so those refuse: the model is not marked valid and the overage is
 * named to the megawatt.
 *
 * ⚠ AND WHEN EVERY ROW IS RED, RED HAS STOPPED SIGNIFYING (CLAUDE.md, 09-26).
 * Each check here earns its place by catching a mistake that has actually been
 * made in a real model. A check that fires on half the lines is noise and
 * belongs in neither list.
 *
 * Pure, no imports beyond sibling modules. Safe for a verification script.
 */

import type { LedgerResult } from './ledger'
import type { LineResult } from './lines'
import { provenanceAgeDays } from './provenance'
import type { CaptureTiers } from './capture'
import { MONEY_SHAPE_LABELS } from './types'
import type { DealEconomicsInput, RevenueLine } from './types'
import { energyPricePerKwh } from './units'

export type WarningCode =
  | 'energy_price_band'
  | 'dc_rate_unit'
  | 'zero_margin'
  | 'block_design_mismatch'
  | 'stale_benchmark'
  | 'undated_source'
  | 'peak_above_firm'
  | 'bucket_peak_exceeded'
  | 'ownership_unset'
  | 'power_double_counted'
  | 'unattributed_total'
  | 'load_factor_range'
  | 'occupancy_range'
  | 'pue_range'
  | 'no_firm_capacity'
  | 'no_allocation_ledger'

export interface EconomicsWarning {
  code: WarningCode
  /** The sentence shown to the reader. Says what is wrong and what to do. */
  message: string
  lineId: string | null
  sourceId: string | null
}

export type ErrorCode =
  | 'ledger_overage'
  | 'orphaned_draw'
  | 'invalid_schedule'
  | 'reference_cycle'
  | 'missing_reference'

export interface EconomicsError {
  code: ErrorCode
  message: string
  lineId: string | null
}

/** The sane band for a retail or wholesale energy price, in dollars per kWh. */
export const ENERGY_PRICE_MIN_PER_KWH = 0.02
export const ENERGY_PRICE_MAX_PER_KWH = 0.5

/**
 * Above this, a $/kW-month data center rate is almost certainly a $/kW-year
 * figure in the wrong field. Primary-market wholesale sits near $100 to $200 a
 * month; $1,800 a year entered as monthly is a 12x error that reads as a
 * spectacular deal rather than as a mistake.
 */
export const DC_RATE_PER_KW_MONTH_SUSPICIOUS_ABOVE = 500

/** A benchmark older than this wants a second look before it prices a deal. */
export const BENCHMARK_STALE_DAYS = 365

function pushLinePriceWarnings(
  line: RevenueLine,
  warnings: EconomicsWarning[]
): void {
  if (line.type === 'energy_sale' && line.price != null) {
    const perKwh = energyPricePerKwh(line.price, line.priceUnit)
    if (perKwh < ENERGY_PRICE_MIN_PER_KWH || perKwh > ENERGY_PRICE_MAX_PER_KWH) {
      warnings.push({
        code: 'energy_price_band',
        message: `"${line.label}" prices energy at $${perKwh.toFixed(
          4
        )}/kWh, outside the $${ENERGY_PRICE_MIN_PER_KWH} to $${ENERGY_PRICE_MAX_PER_KWH} band. Check the unit.`,
        lineId: line.id,
        sourceId: null,
      })
    }
    if (line.loadFactor != null && (line.loadFactor < 0 || line.loadFactor > 1)) {
      warnings.push({
        code: 'load_factor_range',
        message: `"${line.label}" has a load factor of ${line.loadFactor}. It is a fraction between 0 and 1, not a percentage.`,
        lineId: line.id,
        sourceId: null,
      })
    }
  }

  if (line.type === 'dc_lease') {
    if (
      line.ratePerKwMonth != null &&
      line.ratePerKwMonth > DC_RATE_PER_KW_MONTH_SUSPICIOUS_ABOVE
    ) {
      warnings.push({
        code: 'dc_rate_unit',
        message: `"${line.label}" is $${line.ratePerKwMonth}/kW-month, which looks like a per kW-year rate entered in the monthly field.`,
        lineId: line.id,
        sourceId: null,
      })
    }
    if (line.occupancy != null && (line.occupancy < 0 || line.occupancy > 1)) {
      warnings.push({
        code: 'occupancy_range',
        message: `"${line.label}" has occupancy of ${line.occupancy}. It is a fraction between 0 and 1, not a percentage.`,
        lineId: line.id,
        sourceId: null,
      })
    }
    if (line.pue != null && (line.pue < 1 || line.pue > 2.5)) {
      warnings.push({
        code: 'pue_range',
        message: `"${line.label}" has a PUE of ${line.pue}. Below 1 is impossible and above 2.5 is unusual for a new build.`,
        lineId: line.id,
        sourceId: null,
      })
    }
    if (line.powerPassedThrough && line.powerRevenueRetained) {
      warnings.push({
        code: 'power_double_counted',
        message: `"${line.label}" passes power through to the tenant and also keeps it as revenue. Confirm that is deliberate, or the same power is counted twice.`,
        lineId: line.id,
        sourceId: null,
      })
    }
  }
}

/**
 * Zero or negative margin on a one-time line.
 *
 * Priced at cost is a real decision someone might make, so this warns rather
 * than refusing. What it must not do is stay silent: a $20M/MW build at a
 * $20M/MW cost is a line that earns nothing, and that is invisible in a revenue
 * total.
 */
function pushMarginWarnings(line: RevenueLine, warnings: EconomicsWarning[]): void {
  if (line.type === 'one_time_per_mw' && line.pricePerMw != null && line.costPerMw != null) {
    if (line.costPerMw >= line.pricePerMw) {
      warnings.push({
        code: 'zero_margin',
        message: `"${line.label}" costs $${line.costPerMw.toLocaleString()}/MW against revenue of $${line.pricePerMw.toLocaleString()}/MW, so it earns nothing.`,
        lineId: line.id,
        sourceId: null,
      })
    }
  }
  if (
    line.type === 'one_time_per_unit' &&
    line.pricePerUnit != null &&
    line.costPerUnit != null &&
    line.costPerUnit >= line.pricePerUnit
  ) {
    warnings.push({
      code: 'zero_margin',
      message: `"${line.label}" costs as much per ${line.unitLabel ?? 'unit'} as it earns, so it earns nothing.`,
      lineId: line.id,
      sourceId: null,
    })
  }
  if (
    line.type === 'one_time_lump' &&
    line.amount != null &&
    line.cost != null &&
    line.cost >= line.amount
  ) {
    warnings.push({
      code: 'zero_margin',
      message: `"${line.label}" costs at least as much as it earns, so it earns nothing.`,
      lineId: line.id,
      sourceId: null,
    })
  }
}

function pushProvenanceWarnings(
  line: RevenueLine,
  warnings: EconomicsWarning[],
  now: Date
): void {
  if (!line.fields) return
  for (const [field, p] of Object.entries(line.fields)) {
    if (p.status !== 'benchmark') continue
    const age = provenanceAgeDays(p, now)
    if (age == null) {
      warnings.push({
        code: 'undated_source',
        message: `"${line.label}" uses a benchmark for ${field} with no date, so its age cannot be judged.`,
        lineId: line.id,
        sourceId: null,
      })
      continue
    }
    if (age > BENCHMARK_STALE_DAYS) {
      const months = Math.floor(age / 30)
      warnings.push({
        code: 'stale_benchmark',
        message: `"${line.label}" prices ${field} off a benchmark ${months} months old. Refresh it before it prices a deal.`,
        lineId: line.id,
        sourceId: null,
      })
    }
  }
}

export interface CollectArgs {
  input: DealEconomicsInput
  lines: LineResult[]
  ledger: LedgerResult
  tiers: CaptureTiers
  cycleLineIds: string[]
  now?: Date
}

export function collectWarnings(args: CollectArgs): EconomicsWarning[] {
  const { input, ledger, tiers } = args
  const now = args.now ?? new Date()
  const warnings: EconomicsWarning[] = []

  for (const line of input.lines) {
    pushLinePriceWarnings(line, warnings)
    pushMarginWarnings(line, warnings)
    pushProvenanceWarnings(line, warnings, now)
  }

  for (const source of ledger.sources) {
    if (source.statedNetMismatch) {
      const { stated, derived } = source.statedNetMismatch
      warnings.push({
        code: 'block_design_mismatch',
        message: `"${source.label}" works out to ${derived.toLocaleString()} MW firm from its block design, but is stated as ${stated.toLocaleString()} MW net.`,
        lineId: null,
        sourceId: source.sourceId,
      })
    }
  }

  // Sizing to average load while ignoring peak is a known failure in the
  // existing models, so peak is compared wherever anyone has entered one.
  if (ledger.peakMw != null && ledger.firmMw != null && ledger.peakMw > ledger.firmMw) {
    warnings.push({
      code: 'peak_above_firm',
      message: `Stated peak of ${ledger.peakMw.toLocaleString()} MW exceeds ${ledger.firmMw.toLocaleString()} MW firm. The allocations add average loads; the plant has to serve the peak.`,
      lineId: null,
      sourceId: null,
    })
  }

  for (const bucket of ledger.buckets) {
    if (bucket.peakMw != null && bucket.allocatedMw > bucket.peakMw) {
      warnings.push({
        code: 'bucket_peak_exceeded',
        message: `"${bucket.label}" allocates ${bucket.allocatedMw.toLocaleString()} MW against a stated peak of ${bucket.peakMw.toLocaleString()} MW.`,
        lineId: null,
        sourceId: null,
      })
    }
  }

  if (ledger.noBuckets && ledger.allocatedMw > 0) {
    warnings.push({
      code: 'no_allocation_ledger',
      message: `This model has no allocation buckets, so ${ledger.allocatedMw.toLocaleString()} MW of load belongs to nobody. Add the buckets before treating it as a deal model.`,
      lineId: null,
      sourceId: null,
    })
  }

  if (ledger.firmMw == null && input.lines.length > 0) {
    warnings.push({
      code: 'no_firm_capacity',
      message:
        'No capacity source has enough entered to work out firm MW, so utilization and every per-MW figure are unavailable.',
      lineId: null,
      sourceId: null,
    })
  }

  if (!tiers.ownershipComplete) {
    const names = tiers.spvsMissingOwnership.map((s) => s.label).join(', ')
    warnings.push({
      code: 'ownership_unset',
      message: `No Ber Wilson ownership split is set for ${names}, so revenue earned there is shown as undetermined rather than as ours.`,
      lineId: null,
      sourceId: null,
    })
  }

  // The remainder between a stated deal total and the sum of the lines is the
  // part nobody has priced. Naming it is the whole value: absorbed silently it
  // reads as a complete model.
  //
  // ⚠ COMPARED AGAINST THE FIGURE OF THE SAME SHAPE, NEVER A MIXTURE. An
  // annual stated total measured against a contract value reports the entire
  // deal as unattributed, which is worse than saying nothing.
  if (input.statedTotal != null) {
    const g = tiers.grossGenerated
    const bw = tiers.berWilsonGross
    const sum = (...parts: (number | null)[]): number | null =>
      parts.every((p) => p == null) ? null : parts.reduce<number>((a, b) => a + (b ?? 0), 0)
    const matched =
      input.statedTotal.shape === 'recurring'
        ? g.annualRecurringRevenue
        : input.statedTotal.shape === 'contract'
          ? g.contractValue
          : input.statedTotal.shape === 'one_time'
            ? sum(g.oneTimeRevenue, g.taxCredits)
            : input.statedTotal.shape === 'asset'
              ? g.stabilizedAssetValue
              : sum(bw.contractValue, bw.oneTimeRevenue, bw.taxCredits)
    // Null here is not zero: no line has produced a figure of this shape at
    // all, so the whole stated total is unaccounted for. Worth saying plainly,
    // and distinguishable from a model that is partly priced.
    const accounted = matched ?? 0
    const remainder = input.statedTotal.amount - accounted
    if (Math.abs(remainder) > 1) {
      const unpriced = args.lines.filter((l) => l.missing.length > 0).map((l) => l.label)
      const tail =
        unpriced.length > 0
          ? ` Lines still missing a pricing basis: ${unpriced.join(', ')}.`
          : ''
      const shapeLabel = MONEY_SHAPE_LABELS[input.statedTotal.shape].toLowerCase()
      const lead =
        matched == null
          ? `No line produces ${shapeLabel} yet, so the whole stated $${Math.round(
              input.statedTotal.amount
            ).toLocaleString()} is unattributed.`
          : `The lines account for $${Math.round(
              accounted
            ).toLocaleString()} of ${shapeLabel} against a stated $${Math.round(
              input.statedTotal.amount
            ).toLocaleString()}, leaving $${Math.round(
              Math.abs(remainder)
            ).toLocaleString()} ${remainder > 0 ? 'unattributed' : 'over'}.`
      warnings.push({
        code: 'unattributed_total',
        message: `${lead}${tail}`,
        lineId: null,
        sourceId: null,
      })
    }
  }

  return warnings
}

export function collectErrors(args: CollectArgs): EconomicsError[] {
  const { ledger, lines, cycleLineIds, input } = args
  const errors: EconomicsError[] = []

  if (ledger.overageMw != null) {
    errors.push({
      code: 'ledger_overage',
      message: `Allocations total ${ledger.allocatedMw.toLocaleString()} MW against ${(
        ledger.firmMw ?? 0
      ).toLocaleString()} MW firm, which is ${ledger.overageMw.toLocaleString()} MW more capacity than the deal has.`,
      lineId: null,
    })
  }

  for (const orphan of ledger.orphanedDraws) {
    errors.push({
      code: 'orphaned_draw',
      message: `"${orphan.lineLabel}" draws megawatts but names no allocation bucket, so its load is in no total.`,
      lineId: orphan.lineId,
    })
  }

  for (const line of lines) {
    for (const message of line.errors) {
      const code: ErrorCode = cycleLineIds.includes(line.lineId)
        ? 'reference_cycle'
        : message.startsWith('Milestone')
          ? 'invalid_schedule'
          : 'missing_reference'
      errors.push({ code, message: `"${line.label}": ${message}`, lineId: line.lineId })
    }
  }

  const ids = new Set(input.lines.map((l) => l.id))
  if (ids.size !== input.lines.length) {
    errors.push({
      code: 'missing_reference',
      message: 'Two lines share an id, so a fee could be charged against the wrong one.',
      lineId: null,
    })
  }

  return errors
}
