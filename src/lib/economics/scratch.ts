/**
 * The quick calc: MW and one price, in, a labelled deal size out.
 *
 * ⚠ IT BUILDS A REAL MODEL AND CALLS THE REAL ENGINE. There is no second, looser
 * formula for the scratchpad. A shared engine wired to one surface is worse than
 * no shared engine, and a back-of-envelope figure that disagrees with the deal
 * tab by 8% is worse than no scratchpad at all. The only difference is that a
 * scratch model has no allocation buckets, which the ledger treats as "no ledger
 * in play" rather than as a violated one.
 *
 * ⚠ AND THE PRICE UNIT PICKS THE FORMULA, WHICH THE SCREEN THEN SAYS OUT LOUD.
 * $/kWh is an energy sale and needs a load factor; $/kW-month is a capacity or
 * lease charge and needs a PUE if it is IT load; $/MW is a one-time build. The
 * same two numbers mean three different deals, so the reader is told which one
 * was computed rather than being left to assume.
 *
 * Pure: safe in the browser, in a test, and on the server.
 */

import { computeDealEconomics, type DealEconomicsResult } from './compute'
import type { DealEconomicsInput, RevenueLine } from './types'

export type ScratchUnit = 'per_kwh' | 'per_kw_month' | 'per_mw'

export const SCRATCH_UNITS: readonly { value: ScratchUnit; label: string; shape: string }[] = [
  { value: 'per_kwh', label: '$/kWh', shape: 'Energy sold' },
  { value: 'per_kw_month', label: '$/kW-month', shape: 'Capacity or lease' },
  { value: 'per_mw', label: '$/MW', shape: 'One-time build' },
]

export interface ScratchInput {
  mw: number | null
  price: number | null
  unit: ScratchUnit
  /** Energy only. How much of the MW is consumed on average, 0 to 1. */
  loadFactor: number | null
  /** Capacity or lease only. Set it and the MW is read as IT load. */
  pue: number | null
  termYears: number | null
  escalatorPct: number | null
  discountRatePct: number | null
  /** A fee on the whole line, which is what makes capture appear. */
  capturePct: number | null
}

export const EMPTY_SCRATCH: ScratchInput = {
  mw: null,
  price: null,
  unit: 'per_kwh',
  loadFactor: null,
  pue: null,
  termYears: null,
  escalatorPct: null,
  discountRatePct: null,
  capturePct: null,
}

export interface ScratchResult {
  result: DealEconomicsResult
  /** Which formula ran, in the words the reader needs to check it. */
  formula: string
  /** True once there is enough to compute anything at all. */
  ready: boolean
}

const SCRATCH_LINE_ID = 'scratch-line'
const SCRATCH_FEE_ID = 'scratch-fee'

function baseLine() {
  return {
    id: SCRATCH_LINE_ID,
    label: 'Scratch line',
    spvId: null,
    isBerWilsonRevenue: true,
    status: 'planning_assumption' as const,
    notes: null,
    costs: { opexAnnual: null, fixedOmPerKwYear: null, variableOmPerMwh: null, fuel: null },
  }
}

/** Build the model a set of scratch inputs describes. */
export function scratchModel(input: ScratchInput): DealEconomicsInput {
  const lines: RevenueLine[] = []
  const recurring = {
    startYear: null,
    termYears: input.termYears,
    escalatorPct: input.escalatorPct,
    ramp: null,
  }

  if (input.unit === 'per_kwh') {
    lines.push({
      ...baseLine(),
      ...recurring,
      type: 'energy_sale',
      bucketId: null,
      mode: 'forward',
      mw: input.mw,
      loadFactor: input.loadFactor,
      price: input.price,
      priceUnit: 'per_kwh',
      targetAnnualRevenue: null,
      minimumTakePct: null,
    })
  } else if (input.unit === 'per_kw_month') {
    if (input.pue != null) {
      // A PUE given means the MW entered is IT load, so the ledger draws
      // mw x PUE. Reading it as facility load instead would understate the
      // plant by 30% on a typical design.
      lines.push({
        ...baseLine(),
        ...recurring,
        type: 'dc_lease',
        bucketId: null,
        itMw: input.mw,
        ratePerKwMonth: input.price,
        occupancy: 1,
        pue: input.pue,
        powerPassedThrough: false,
        powerRevenueRetained: false,
      })
    } else {
      lines.push({
        ...baseLine(),
        ...recurring,
        type: 'capacity_charge',
        bucketId: null,
        mw: input.mw,
        price: input.price,
        priceUnit: 'per_kw_month',
      })
    }
  } else {
    lines.push({
      ...baseLine(),
      type: 'one_time_per_mw',
      schedule: null,
      countsTowardProjectValue: true,
      mw: input.mw,
      pricePerMw: input.price,
      costPerMw: null,
    })
  }

  if (input.capturePct != null) {
    // The line above becomes the gross and this becomes ours, which is the
    // whole point of the scratchpad on a partner-heavy deal.
    lines[0] = { ...lines[0], isBerWilsonRevenue: false }
    lines.push({
      ...baseLine(),
      id: SCRATCH_FEE_ID,
      label: 'Ber Wilson fee',
      type: 'fee_margin',
      referencedLineId: SCRATCH_LINE_ID,
      pctOfLine: input.capturePct,
      isCarveOut: true,
    })
  }

  return {
    sources: [],
    buckets: [],
    spvs: [],
    lines,
    discountRatePct: input.discountRatePct,
    capRatePct: null,
    baseYear: null,
    statedTotal: null,
  }
}

export function computeScratch(input: ScratchInput): ScratchResult {
  const ready = input.mw != null && input.price != null
  const result = computeDealEconomics(scratchModel(input))

  const formula =
    input.unit === 'per_kwh'
      ? `${input.mw ?? 0} MW x 8,760 hours x load factor x price per kWh`
      : input.unit === 'per_kw_month'
        ? input.pue != null
          ? `${input.mw ?? 0} MW of IT load x 1,000 kW x rate x 12 months, drawing ${
              input.mw != null && input.pue != null
                ? (input.mw * input.pue).toLocaleString('en-US', { maximumFractionDigits: 1 })
                : '?'
            } MW on the plant at PUE ${input.pue}`
          : `${input.mw ?? 0} MW x 1,000 kW x rate x 12 months`
        : `${input.mw ?? 0} MW x price per MW`

  return { result, formula, ready }
}

// ── URL round trip ──────────────────────────────────────────────────────────
//
// ⚠ THE SCRATCHPAD'S STATE LIVES IN THE URL SO A NUMBER RUN ON A CALL IS A LINK.
// A filter kept only in component state cannot be linked, bookmarked or sent to
// anyone, which reads as the thing having no page (CLAUDE.md §12, 10-03). It
// also means a figure quoted to a prospect can be reproduced exactly.

const PARAM_KEYS: Record<keyof Omit<ScratchInput, 'unit'>, string> = {
  mw: 'mw',
  price: 'p',
  loadFactor: 'lf',
  pue: 'pue',
  termYears: 'term',
  escalatorPct: 'esc',
  discountRatePct: 'disc',
  capturePct: 'cap',
}

export function scratchToParams(input: ScratchInput): URLSearchParams {
  const params = new URLSearchParams()
  params.set('u', input.unit)
  for (const [field, key] of Object.entries(PARAM_KEYS) as [keyof ScratchInput, string][]) {
    const value = input[field]
    if (typeof value === 'number' && Number.isFinite(value)) params.set(key, String(value))
  }
  return params
}

export function scratchFromParams(params: URLSearchParams | Record<string, string | undefined>): ScratchInput {
  const get = (key: string): string | undefined =>
    params instanceof URLSearchParams ? (params.get(key) ?? undefined) : params[key]

  const num = (key: string): number | null => {
    const raw = get(key)
    if (raw == null || raw === '') return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }

  const unit = get('u')
  return {
    unit: unit === 'per_kw_month' || unit === 'per_mw' ? unit : 'per_kwh',
    mw: num('mw'),
    price: num('p'),
    loadFactor: num('lf'),
    pue: num('pue'),
    termYears: num('term'),
    escalatorPct: num('esc'),
    discountRatePct: num('disc'),
    capturePct: num('cap'),
  }
}
