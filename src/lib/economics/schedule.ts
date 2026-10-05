/**
 * Time: ramp, escalation, term, and what a stream of years is worth.
 *
 * Pure, no imports beyond sibling types. Safe for a verification script.
 */

import type { ScheduleEntry } from './types'

export interface YearRow {
  /** 1-based position in the term. */
  year: number
  /** Calendar year, when a start year is known. */
  calendarYear: number | null
  rampFactor: number
  escalationFactor: number
  revenue: number
}

/**
 * The ramp multiplier for a 1-based year.
 *
 * A ramp shorter than the term carries its LAST value forward rather than
 * falling to zero. A lease-up schedule of [0.3, 0.7, 1.0] over fifteen years
 * means stabilized from year 3, not dark from year 4.
 */
export function rampFactor(ramp: number[] | null, year: number): number {
  if (!ramp || ramp.length === 0) return 1
  const index = Math.min(Math.max(year, 1), ramp.length) - 1
  const value = ramp[index]
  return Number.isFinite(value) ? value : 1
}

/** (1 + escalator) ^ (year - 1). Year 1 never escalates. */
export function escalationFactor(escalatorPct: number | null, year: number): number {
  if (escalatorPct == null || !Number.isFinite(escalatorPct)) return 1
  return Math.pow(1 + escalatorPct / 100, Math.max(year, 1) - 1)
}

export interface ProjectYearsArgs {
  baseAnnualRevenue: number
  termYears: number
  escalatorPct: number | null
  ramp: number[] | null
  startYear: number | null
}

/** Rev(y) = base x ramp(y) x (1 + escalator)^(y-1), one row per year of term. */
export function projectYears(args: ProjectYearsArgs): YearRow[] {
  const term = Math.max(0, Math.floor(args.termYears))
  const rows: YearRow[] = []
  for (let year = 1; year <= term; year += 1) {
    const ramp = rampFactor(args.ramp, year)
    const escalation = escalationFactor(args.escalatorPct, year)
    rows.push({
      year,
      calendarYear: args.startYear == null ? null : args.startYear + year - 1,
      rampFactor: ramp,
      escalationFactor: escalation,
      revenue: args.baseAnnualRevenue * ramp * escalation,
    })
  }
  return rows
}

/** Contract value: the term's revenue summed, escalation and ramp included. */
export function contractValue(years: YearRow[]): number {
  return years.reduce((sum, row) => sum + row.revenue, 0)
}

/**
 * The year a stream reaches its stabilized figure: the first year at the
 * highest ramp factor. "Annual recurring revenue at stabilization" is that
 * year's revenue BEFORE escalation, so two deals are comparable in today's
 * dollars rather than one looking larger for starting later.
 */
export function stabilizedAnnualRevenue(baseAnnualRevenue: number, ramp: number[] | null): number {
  if (!ramp || ramp.length === 0) return baseAnnualRevenue
  const peak = ramp.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0)
  return baseAnnualRevenue * (peak > 0 ? peak : 1)
}

/**
 * NPV of a year stream at a discount rate, end-of-year convention.
 *
 * Returns null when no rate is given. There is no default discount rate in
 * this engine: picking one silently would make an unreviewed opinion look like
 * a property of the deal.
 */
export function npv(years: YearRow[], discountRatePct: number | null): number | null {
  if (discountRatePct == null || !Number.isFinite(discountRatePct)) return null
  const rate = discountRatePct / 100
  if (rate <= -1) return null
  return years.reduce((sum, row) => sum + row.revenue / Math.pow(1 + rate, row.year), 0)
}

export interface ScheduleCheck {
  ok: boolean
  totalPct: number
  /** The sentence to show the reader. Null when the schedule is fine. */
  problem: string | null
}

/**
 * A milestone schedule must total 100%.
 *
 * 95% is not "mostly right", it is a line that cannot be invoiced, so this
 * blocks rather than warns. The tolerance absorbs float noise from entering
 * thirds, nothing more.
 */
export function checkSchedule(schedule: ScheduleEntry[] | null): ScheduleCheck {
  if (!schedule || schedule.length === 0) {
    return { ok: true, totalPct: 0, problem: null }
  }
  const total = schedule.reduce((sum, entry) => sum + (Number.isFinite(entry.pct) ? entry.pct : 0), 0)
  if (Math.abs(total - 100) <= 1e-6) {
    return { ok: true, totalPct: total, problem: null }
  }
  const rounded = Math.round(total * 100) / 100
  return {
    ok: false,
    totalPct: total,
    problem: `Milestone percentages total ${rounded}%, not 100%`,
  }
}

export interface ScheduleAmount extends ScheduleEntry {
  amount: number
}

/** A validated schedule's percentages applied to a total. */
export function scheduleAmounts(
  total: number,
  schedule: ScheduleEntry[] | null
): ScheduleAmount[] {
  if (!schedule) return []
  return schedule.map((entry) => ({ ...entry, amount: total * (entry.pct / 100) }))
}
