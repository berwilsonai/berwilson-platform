/**
 * Builders for the engine's tests and verification scripts.
 *
 * TEST SUPPORT ONLY. No application code imports this file. It exists because
 * the engine deliberately has no defaults — every rate, factor and term is
 * nullable and means "nobody has said" — so constructing a line by hand in a
 * test is thirty fields of null. These builders supply the nulls; a test
 * supplies only what it is actually testing, which is what keeps the assertions
 * readable.
 */

import type {
  CapacityBucket,
  CapacitySource,
  DealEconomicsInput,
  LineCosts,
  RevenueLine,
  Spv,
} from './types'
import { NO_COSTS } from './types'

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

export function resetIds(): void {
  seq = 0
}

export function source(over: Partial<CapacitySource> = {}): CapacitySource {
  return {
    id: over.id ?? nextId('src'),
    label: 'Source',
    kind: 'grid_interconnect',
    nameplateMw: null,
    availabilityPct: null,
    blockCount: null,
    redundantBlocks: null,
    blockMw: null,
    statedNetMw: null,
    status: 'planning_assumption',
    ...over,
  }
}

export function bucket(over: Partial<CapacityBucket> = {}): CapacityBucket {
  return {
    id: over.id ?? nextId('bkt'),
    label: 'Bucket',
    priority: 10,
    peakMw: null,
    ...over,
  }
}

export function spv(over: Partial<Spv> = {}): Spv {
  return {
    id: over.id ?? nextId('spv'),
    label: 'SPV',
    purpose: 'other',
    entityId: null,
    bwOwnershipPct: null,
    status: 'planning_assumption',
    ...over,
  }
}

export function costs(over: Partial<LineCosts> = {}): LineCosts {
  return { ...NO_COSTS, ...over }
}

type LineOf<T extends RevenueLine['type']> = Extract<RevenueLine, { type: T }>

/**
 * A line of the given type with every field null and nothing assumed.
 *
 * The `as` casts are confined to this one function on purpose: it builds a
 * union member from a partial, which TypeScript cannot narrow, and keeping the
 * cast here means no test or application file needs one.
 */
export function line<T extends RevenueLine['type']>(
  type: T,
  over: Partial<LineOf<T>> = {}
): LineOf<T> {
  const base = {
    id: nextId('line'),
    label: `${type} line`,
    spvId: null,
    isBerWilsonRevenue: true,
    status: 'planning_assumption' as const,
    costs: { ...NO_COSTS },
    notes: null,
  }
  const recurring = { startYear: null, termYears: null, escalatorPct: null, ramp: null }
  const oneTime = { schedule: null, countsTowardProjectValue: true }

  const shapes: Record<RevenueLine['type'], Record<string, unknown>> = {
    energy_sale: {
      ...recurring,
      bucketId: null,
      mode: 'forward',
      mw: null,
      loadFactor: null,
      price: null,
      priceUnit: 'per_kwh',
      targetAnnualRevenue: null,
      minimumTakePct: null,
    },
    capacity_charge: {
      ...recurring,
      bucketId: null,
      mw: null,
      price: null,
      priceUnit: 'per_kw_month',
    },
    dc_lease: {
      ...recurring,
      bucketId: null,
      itMw: null,
      ratePerKwMonth: null,
      occupancy: null,
      pue: null,
      powerPassedThrough: false,
      powerRevenueRetained: false,
    },
    subscription: {
      ...recurring,
      bucketId: null,
      units: null,
      pricePerUnitMonth: null,
      unitLabel: null,
      mw: null,
    },
    om_service: {
      ...recurring,
      bucketId: null,
      mw: null,
      price: null,
      priceUnit: 'per_kw_year',
      counterparty: null,
    },
    energy_attribute: { ...recurring, ridesOnLineId: null, pricePerMwh: null, attributeKind: null },
    recurring_fee_on_line: {
      ...recurring,
      referencedLineId: null,
      base: 'referenced_line_value',
      capitalBase: null,
      annualRatePct: null,
      ourSharePct: null,
      partnerLabel: null,
      isCarveOut: false,
    },
    one_time_per_mw: { ...oneTime, mw: null, pricePerMw: null, costPerMw: null },
    one_time_per_unit: {
      ...oneTime,
      quantity: null,
      pricePerUnit: null,
      costPerUnit: null,
      unitLabel: null,
    },
    one_time_lump: { ...oneTime, amount: null, cost: null },
    tax_credit: {
      ...oneTime,
      amount: null,
      kind: 'other',
      transferable: false,
      ourSharePct: null,
      countsTowardProjectValue: false,
    },
    land: {
      ...oneTime,
      disposition: 'sale',
      acres: null,
      mw: null,
      price: null,
      priceUnit: 'per_acre',
      annualRent: null,
      escalatorPct: null,
      termYears: null,
      startYear: null,
      bucketId: null,
    },
    fee_margin: { referencedLineId: null, pctOfLine: null, isCarveOut: true },
  }

  return { ...base, type, ...shapes[type], ...over } as unknown as LineOf<T>
}

export function deal(over: Partial<DealEconomicsInput> = {}): DealEconomicsInput {
  return {
    sources: [],
    buckets: [],
    lines: [],
    spvs: [],
    discountRatePct: null,
    capRatePct: null,
    baseYear: null,
    statedTotal: null,
    ...over,
  }
}

/** Assert within a relative tolerance, for the figures the brief states as "about". */
export function closeTo(actual: number, expected: number, relTolerance = 0.001): boolean {
  if (expected === 0) return Math.abs(actual) <= relTolerance
  return Math.abs((actual - expected) / expected) <= relTolerance
}
