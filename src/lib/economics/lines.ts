/**
 * One formula per revenue line type, and the reference graph that orders them.
 *
 * ⚠ EMPTY MEANS EMPTY. A line missing an input returns null and names what is
 * missing; it never returns zero. A zero reads on screen as a real answer, and
 * a deal summed from zeros looks small rather than unfinished. `missing` is a
 * list the reader can act on, `errors` is what makes the whole model invalid.
 *
 * ⚠ AND THE SAME MEGAWATT MAY NOT APPEAR IN TWO REVENUE LINES. The types that
 * draw declare a bucket and their own load; the types that ride on another
 * line's volume draw nothing. A drawing line that also claims to ride on
 * another line is an error, not a line that gets its capacity twice.
 *
 * Pure, no imports beyond sibling modules. Safe for a verification script.
 */

import { annualCost, noi } from './costs'
import type { CapacityDraw } from './ledger'
import { weakestStatus, type ProvenanceStatus } from './provenance'
import {
  checkSchedule,
  contractValue as sumYears,
  npv as computeNpv,
  projectYears,
  scheduleAmounts,
  stabilizedAnnualRevenue,
  type ScheduleAmount,
  type YearRow,
} from './schedule'
import type { DealEconomicsInput, RevenueLine, RevenueLineType } from './types'
import {
  annualEnergyMwh,
  capacityPricePerKwMonth,
  energyPricePerKwh,
  energyPricePerMwh,
  facilityMwFromItMw,
  impliedAverageMw as impliedMw,
  mwToKw,
  MONTHS_PER_YEAR,
} from './units'

export interface LineResult {
  lineId: string
  label: string
  type: RevenueLineType
  spvId: string | null
  /** Whether this line's money is Ber Wilson's at all. */
  isBerWilsonRevenue: boolean
  /** A tax credit is money and is not revenue. */
  countsAsRevenue: boolean
  /** Fee and margin lines are capture whatever their revenue flag says. */
  isCaptureLine: boolean
  /**
   * True when this line's money is already inside another line's value, so the
   * gross total must not count it twice. Only fee types can be carve-outs.
   */
  isCarveOut: boolean
  shape: 'recurring' | 'one_time'
  /** Annual revenue at stabilization, before escalation. */
  annualRevenue: number | null
  annualEnergyMwh: number | null
  /** Reverse mode only: the average load the target revenue implies. */
  impliedAverageMw: number | null
  /** Facility megawatts this line draws. Zero for a line that draws nothing. */
  facilityMw: number
  bucketId: string | null
  years: YearRow[]
  contractValue: number | null
  oneTimeValue: number | null
  /** Contribution to total project value, the capex view. */
  projectValue: number | null
  taxCreditValue: number | null
  npv: number | null
  annualOpex: number | null
  annualNoi: number | null
  schedule: ScheduleAmount[]
  /**
   * The figure a fee or margin line multiplies: a one-time line's value, or a
   * recurring line's contract value over its term.
   */
  referenceValue: number | null
  status: ProvenanceStatus
  missing: string[]
  errors: string[]
}

function lineStatus(line: RevenueLine, inherited: (ProvenanceStatus | null)[] = []): ProvenanceStatus {
  const fieldStatuses = line.fields ? Object.values(line.fields).map((f) => f.status) : []
  return weakestStatus([line.status, ...fieldStatuses, ...inherited]) ?? line.status
}

function blank(line: RevenueLine, shape: LineResult['shape']): LineResult {
  return {
    lineId: line.id,
    label: line.label,
    type: line.type,
    spvId: line.spvId,
    isBerWilsonRevenue: line.isBerWilsonRevenue,
    countsAsRevenue: line.type !== 'tax_credit',
    isCaptureLine: line.type === 'fee_margin' || line.type === 'recurring_fee_on_line',
    isCarveOut:
      (line.type === 'fee_margin' || line.type === 'recurring_fee_on_line') && line.isCarveOut,
    shape,
    annualRevenue: null,
    annualEnergyMwh: null,
    impliedAverageMw: null,
    facilityMw: 0,
    bucketId: null,
    years: [],
    contractValue: null,
    oneTimeValue: null,
    projectValue: null,
    taxCreditValue: null,
    npv: null,
    annualOpex: null,
    annualNoi: null,
    schedule: [],
    referenceValue: null,
    status: lineStatus(line),
    missing: [],
    errors: [],
  }
}

interface RecurringFinishArgs {
  result: LineResult
  baseAnnualRevenue: number
  termYears: number | null
  escalatorPct: number | null
  ramp: number[] | null
  startYear: number | null
  baseYear: number | null
  discountRatePct: number | null
}

/**
 * Turn a base annual figure into a term, a contract value and an NPV.
 *
 * A recurring line with no term reports its annual figure and no contract
 * value. That is the honest answer: a contract total needs a term, and
 * assuming one would invent the single largest number on the screen.
 */
function finishRecurring(args: RecurringFinishArgs): void {
  const { result } = args
  result.annualRevenue = stabilizedAnnualRevenue(args.baseAnnualRevenue, args.ramp)

  if (args.termYears == null || !Number.isFinite(args.termYears) || args.termYears <= 0) {
    result.missing.push('Term in years, needed for a contract value')
    return
  }

  result.years = projectYears({
    baseAnnualRevenue: args.baseAnnualRevenue,
    termYears: args.termYears,
    escalatorPct: args.escalatorPct,
    ramp: args.ramp,
    startYear: args.startYear ?? args.baseYear,
  })
  result.contractValue = sumYears(result.years)
  result.npv = computeNpv(result.years, args.discountRatePct)
  result.referenceValue = result.contractValue
  if (args.escalatorPct == null) result.missing.push('Annual escalator')
  if (args.discountRatePct == null) result.missing.push('Deal discount rate, needed for NPV')
}

function finishOneTime(result: LineResult, total: number, schedule: ScheduleAmount[] | null): void {
  result.oneTimeValue = total
  result.referenceValue = total
  if (schedule) result.schedule = schedule
}

function applyCosts(
  result: LineResult,
  line: RevenueLine,
  mw: number | null,
  energyMwh: number | null
): void {
  const cost = annualCost({ costs: line.costs, mw, energyMwh })
  result.annualOpex = cost.total
  result.annualNoi = noi(result.annualRevenue, cost.total)
  for (const m of cost.missing) result.missing.push(m)
}

/**
 * Evaluate one line. `resolved` holds the already-computed lines a derived line
 * may reference, which is why `evaluateLines` orders them topologically first.
 */
export function evaluateLine(
  line: RevenueLine,
  input: DealEconomicsInput,
  resolved: Map<string, LineResult>
): LineResult {
  const discountRatePct = input.discountRatePct
  const baseYear = input.baseYear

  switch (line.type) {
    case 'energy_sale': {
      const r = blank(line, 'recurring')
      r.bucketId = line.bucketId
      if (line.price == null) {
        r.missing.push('Price')
        return r
      }
      const perKwh = energyPricePerKwh(line.price, line.priceUnit)

      if (line.mode === 'reverse') {
        if (line.targetAnnualRevenue == null) {
          r.missing.push('Target annual revenue')
          return r
        }
        const perMwh = energyPricePerMwh(line.price, line.priceUnit)
        if (perMwh <= 0) {
          r.errors.push('Price must be greater than zero to imply a volume')
          return r
        }
        const energy = line.targetAnnualRevenue / perMwh
        r.annualEnergyMwh = energy
        r.impliedAverageMw = impliedMw(energy)
        r.facilityMw = r.impliedAverageMw
        finishRecurring({
          result: r,
          baseAnnualRevenue: line.targetAnnualRevenue,
          termYears: line.termYears,
          escalatorPct: line.escalatorPct,
          ramp: line.ramp,
          startYear: line.startYear,
          baseYear,
          discountRatePct,
        })
        applyCosts(r, line, r.facilityMw, energy)
        if (line.bucketId == null) r.missing.push('Allocation bucket')
        return r
      }

      if (line.mw == null) {
        r.missing.push('MW')
        return r
      }
      if (line.loadFactor == null) {
        r.missing.push('Load factor')
        return r
      }
      const energy = annualEnergyMwh(line.mw, line.loadFactor)
      r.annualEnergyMwh = energy
      r.facilityMw = line.mw
      finishRecurring({
        result: r,
        baseAnnualRevenue: energy * 1000 * perKwh,
        termYears: line.termYears,
        escalatorPct: line.escalatorPct,
        ramp: line.ramp,
        startYear: line.startYear,
        baseYear,
        discountRatePct,
      })
      applyCosts(r, line, line.mw, energy)
      if (line.bucketId == null) r.missing.push('Allocation bucket')
      return r
    }

    case 'capacity_charge':
    case 'om_service': {
      const r = blank(line, 'recurring')
      // A demand charge reserves capacity and therefore allocates it. An O&M
      // agreement is priced on the plant's capacity and consumes none of it.
      const allocates = line.type === 'capacity_charge'
      if (allocates) r.bucketId = line.bucketId
      if (line.mw == null) {
        r.missing.push(allocates ? 'MW' : 'MW the fee is priced on')
        return r
      }
      if (line.price == null) {
        r.missing.push('Price')
        return r
      }
      const perKwMonth = capacityPricePerKwMonth(line.price, line.priceUnit)
      if (allocates) r.facilityMw = line.mw
      finishRecurring({
        result: r,
        baseAnnualRevenue: mwToKw(line.mw) * perKwMonth * MONTHS_PER_YEAR,
        termYears: line.termYears,
        escalatorPct: line.escalatorPct,
        ramp: line.ramp,
        startYear: line.startYear,
        baseYear,
        discountRatePct,
      })
      applyCosts(r, line, line.mw, null)
      if (allocates && line.bucketId == null) r.missing.push('Allocation bucket')
      return r
    }

    case 'dc_lease': {
      const r = blank(line, 'recurring')
      r.bucketId = line.bucketId
      if (line.itMw == null) {
        r.missing.push('Critical IT MW')
        return r
      }
      if (line.ratePerKwMonth == null) {
        r.missing.push('Rate per kW-month')
        return r
      }
      if (line.pue == null) {
        r.missing.push('PUE, needed to draw facility load')
      } else {
        // The ledger holds FACILITY load. Allocating the IT figure would hide
        // the cooling load from every total that matters.
        r.facilityMw = facilityMwFromItMw(line.itMw, line.pue)
      }
      const occupancy = line.occupancy ?? 1
      if (line.occupancy == null) r.missing.push('Occupancy at stabilization')
      finishRecurring({
        result: r,
        baseAnnualRevenue: mwToKw(line.itMw) * line.ratePerKwMonth * MONTHS_PER_YEAR * occupancy,
        termYears: line.termYears,
        escalatorPct: line.escalatorPct,
        ramp: line.ramp,
        startYear: line.startYear,
        baseYear,
        discountRatePct,
      })
      applyCosts(r, line, r.facilityMw || null, null)
      if (line.bucketId == null) r.missing.push('Allocation bucket')
      // The pass-through flags change no arithmetic here: a lease rate is a
      // lease rate. What they are for is the warning that fires when power is
      // passed through to the tenant AND kept as revenue, which is a double
      // count unless someone deliberately says otherwise. See `warnings.ts`.
      return r
    }

    case 'subscription': {
      const r = blank(line, 'recurring')
      r.bucketId = line.bucketId
      if (line.units == null) {
        // A price with no unit count produces no number, deliberately.
        r.missing.push('Number of units')
        return r
      }
      if (line.pricePerUnitMonth == null) {
        r.missing.push('Price per unit per month')
        return r
      }
      if (line.mw != null) r.facilityMw = line.mw
      finishRecurring({
        result: r,
        baseAnnualRevenue: line.units * line.pricePerUnitMonth * MONTHS_PER_YEAR,
        termYears: line.termYears,
        escalatorPct: line.escalatorPct,
        ramp: line.ramp,
        startYear: line.startYear,
        baseYear,
        discountRatePct,
      })
      applyCosts(r, line, line.mw, null)
      return r
    }

    case 'energy_attribute': {
      const r = blank(line, 'recurring')
      // Draws ZERO megawatts: the same electrons already drew once.
      if (line.ridesOnLineId == null) {
        r.missing.push('The energy line this rides on')
        return r
      }
      const base = resolved.get(line.ridesOnLineId)
      if (!base) {
        r.errors.push('The energy line this rides on is not in this model')
        return r
      }
      r.status = lineStatus(line, [base.status])
      if (base.annualEnergyMwh == null) {
        r.missing.push(`Annual energy on "${base.label}"`)
        return r
      }
      if (line.pricePerMwh == null) {
        r.missing.push('Price per MWh')
        return r
      }
      finishRecurring({
        result: r,
        baseAnnualRevenue: base.annualEnergyMwh * line.pricePerMwh,
        termYears: line.termYears ?? null,
        escalatorPct: line.escalatorPct,
        ramp: line.ramp,
        startYear: line.startYear,
        baseYear,
        discountRatePct,
      })
      r.annualEnergyMwh = base.annualEnergyMwh
      applyCosts(r, line, null, base.annualEnergyMwh)
      return r
    }

    case 'recurring_fee_on_line': {
      const r = blank(line, 'recurring')
      if (line.annualRatePct == null) {
        r.missing.push('Annual rate')
        return r
      }
      let base: number | null = null
      if (line.base === 'capital_base') {
        if (line.capitalBase == null) r.missing.push('Capital base')
        else base = line.capitalBase
      } else {
        if (line.referencedLineId == null) {
          r.missing.push('The line this fee is charged against')
          return r
        }
        const ref = resolved.get(line.referencedLineId)
        if (!ref) {
          r.errors.push('The line this fee is charged against is not in this model')
          return r
        }
        r.status = lineStatus(line, [ref.status])
        base =
          line.base === 'referenced_line_annual_revenue' ? ref.annualRevenue : ref.referenceValue
        if (base == null) {
          r.missing.push(`A value on "${ref.label}" to charge the fee against`)
          return r
        }
      }
      if (base == null) return r
      // Our share, not the whole fee. A 1.5% fee split evenly with a partner is
      // 0.75% to Ber Wilson, and the line reports what we actually earn.
      const share = line.ourSharePct == null ? 1 : line.ourSharePct / 100
      if (line.ourSharePct == null) r.missing.push('Our share of the fee')
      finishRecurring({
        result: r,
        baseAnnualRevenue: base * (line.annualRatePct / 100) * share,
        termYears: line.termYears,
        escalatorPct: line.escalatorPct,
        ramp: line.ramp,
        startYear: line.startYear,
        baseYear,
        discountRatePct,
      })
      applyCosts(r, line, null, null)
      return r
    }

    case 'one_time_per_mw': {
      const r = blank(line, 'one_time')
      if (line.mw == null) {
        r.missing.push('MW')
        return r
      }
      if (line.pricePerMw == null) {
        r.missing.push('Price per MW')
        return r
      }
      const check = checkSchedule(line.schedule)
      if (!check.ok && check.problem) r.errors.push(check.problem)
      const total = line.mw * line.pricePerMw
      finishOneTime(r, total, scheduleAmounts(total, line.schedule))
      if (line.countsTowardProjectValue) r.projectValue = total
      if (line.costPerMw != null) {
        r.annualOpex = null
        r.annualNoi = total - line.mw * line.costPerMw
      }
      return r
    }

    case 'one_time_per_unit': {
      const r = blank(line, 'one_time')
      if (line.quantity == null) {
        r.missing.push('Quantity')
        return r
      }
      if (line.pricePerUnit == null) {
        r.missing.push('Price per unit')
        return r
      }
      if (!line.unitLabel) r.missing.push('What the unit is, so the figure can be read')
      const check = checkSchedule(line.schedule)
      if (!check.ok && check.problem) r.errors.push(check.problem)
      const total = line.quantity * line.pricePerUnit
      finishOneTime(r, total, scheduleAmounts(total, line.schedule))
      if (line.countsTowardProjectValue) r.projectValue = total
      if (line.costPerUnit != null) r.annualNoi = total - line.quantity * line.costPerUnit
      return r
    }

    case 'one_time_lump': {
      const r = blank(line, 'one_time')
      if (line.amount == null) {
        r.missing.push('Amount')
        return r
      }
      const check = checkSchedule(line.schedule)
      if (!check.ok && check.problem) r.errors.push(check.problem)
      finishOneTime(r, line.amount, scheduleAmounts(line.amount, line.schedule))
      if (line.countsTowardProjectValue) r.projectValue = line.amount
      if (line.cost != null) r.annualNoi = line.amount - line.cost
      return r
    }

    case 'tax_credit': {
      const r = blank(line, 'one_time')
      r.countsAsRevenue = false
      if (line.amount == null) {
        r.missing.push('Credit amount')
        return r
      }
      const share = line.ourSharePct == null ? 1 : line.ourSharePct / 100
      const total = line.amount * share
      const check = checkSchedule(line.schedule)
      if (!check.ok && check.problem) r.errors.push(check.problem)
      finishOneTime(r, total, scheduleAmounts(total, line.schedule))
      r.taxCreditValue = total
      if (line.countsTowardProjectValue) r.projectValue = total
      return r
    }

    case 'land': {
      const isLease = line.disposition === 'lease'
      const r = blank(line, isLease ? 'recurring' : 'one_time')
      r.bucketId = line.bucketId
      // Powered land priced per MW allocates those megawatts. Per-acre land
      // is acreage and draws nothing.
      if (line.priceUnit === 'per_mw' && line.mw != null) r.facilityMw = line.mw

      if (isLease) {
        if (line.annualRent == null) {
          r.missing.push('Annual rent')
          return r
        }
        finishRecurring({
          result: r,
          baseAnnualRevenue: line.annualRent,
          termYears: line.termYears,
          escalatorPct: line.escalatorPct,
          ramp: null,
          startYear: line.startYear,
          baseYear,
          discountRatePct,
        })
        return r
      }

      if (line.price == null) {
        r.missing.push('Price')
        return r
      }
      const quantity = line.priceUnit === 'per_acre' ? line.acres : line.mw
      if (quantity == null) {
        r.missing.push(line.priceUnit === 'per_acre' ? 'Acres' : 'MW of powered land')
        return r
      }
      const check = checkSchedule(line.schedule)
      if (!check.ok && check.problem) r.errors.push(check.problem)
      const total = quantity * line.price
      finishOneTime(r, total, scheduleAmounts(total, line.schedule))
      if (line.countsTowardProjectValue) r.projectValue = total
      return r
    }

    case 'fee_margin': {
      const r = blank(line, 'one_time')
      if (line.referencedLineId == null) {
        r.missing.push('The line this fee is taken on')
        return r
      }
      const ref = resolved.get(line.referencedLineId)
      if (!ref) {
        r.errors.push('The line this fee is taken on is not in this model')
        return r
      }
      r.status = lineStatus(line, [ref.status])
      if (line.pctOfLine == null) {
        r.missing.push('Percentage')
        return r
      }
      if (ref.referenceValue == null) {
        r.missing.push(`A value on "${ref.label}" to take the fee on`)
        return r
      }
      finishOneTime(r, ref.referenceValue * (line.pctOfLine / 100), null)
      // A fee is ours, not project capex. It must never add to project value or
      // capture would be double counted against the thing it is a share of.
      r.projectValue = null
      return r
    }
  }
}

/** Which line a derived line depends on, or null when it depends on none. */
export function dependencyOf(line: RevenueLine): string | null {
  if (line.type === 'energy_attribute') return line.ridesOnLineId
  if (line.type === 'fee_margin') return line.referencedLineId
  if (line.type === 'recurring_fee_on_line') {
    return line.base === 'capital_base' ? null : line.referencedLineId
  }
  return null
}

export interface EvaluateLinesResult {
  results: LineResult[]
  draws: CapacityDraw[]
  /** Lines in a reference cycle. Each is named, so the reader can break it. */
  cycleLineIds: string[]
}

/**
 * Evaluate every line in dependency order.
 *
 * ⚠ A REFERENCE CYCLE IS AN INVALID MODEL THAT NAMES BOTH LINES, NOT A STACK
 * OVERFLOW. Two fee lines each taking a percentage of the other has no answer,
 * and the reader needs to be told which two rather than seeing the page fail.
 */
export function evaluateLines(input: DealEconomicsInput): EvaluateLinesResult {
  const byId = new Map(input.lines.map((l) => [l.id, l]))
  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const line of input.lines) {
    const dep = dependencyOf(line)
    const real = dep != null && byId.has(dep) ? dep : null
    indegree.set(line.id, real ? 1 : 0)
    if (real) {
      const list = dependents.get(real) ?? []
      list.push(line.id)
      dependents.set(real, list)
    }
  }

  const queue = input.lines.filter((l) => (indegree.get(l.id) ?? 0) === 0).map((l) => l.id)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift() as string
    order.push(id)
    for (const next of dependents.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1
      indegree.set(next, remaining)
      if (remaining === 0) queue.push(next)
    }
  }

  const cycleLineIds = input.lines.map((l) => l.id).filter((id) => !order.includes(id))

  const resolved = new Map<string, LineResult>()
  for (const id of order) {
    const line = byId.get(id)
    if (!line) continue
    resolved.set(id, evaluateLine(line, input, resolved))
  }

  for (const id of cycleLineIds) {
    const line = byId.get(id)
    if (!line) continue
    const r = blank(line, 'one_time')
    r.errors.push('This line and the line it references depend on each other')
    resolved.set(id, r)
  }

  // Keep the author's order on screen; dependency order was only for maths.
  const results = input.lines.map((l) => resolved.get(l.id)).filter((r): r is LineResult => !!r)

  const draws: CapacityDraw[] = results
    .filter((r) => r.facilityMw > 0)
    .map((r) => ({
      lineId: r.lineId,
      lineLabel: r.label,
      bucketId: r.bucketId,
      facilityMw: r.facilityMw,
      peakMw: null,
    }))

  return { results, draws, cycleLineIds }
}
