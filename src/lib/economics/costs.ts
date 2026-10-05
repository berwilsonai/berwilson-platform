/**
 * Operating cost, so a line can report NOI and a margin rather than only
 * revenue, plus the two conversions that are easy to get wrong.
 *
 * Pure, no imports beyond sibling modules. Safe for a verification script.
 */

import type { FuelInput, LineCosts } from './types'
import { HOURS_PER_YEAR, mwToKw } from './units'

/**
 * Fuel cost per kWh from a heat rate and a gas price.
 *
 * `heatRate` is Btu/kWh, `gasPrice` is $/MMBtu, and an MMBtu is 1,000,000 Btu,
 * so the division by 1e6 is the unit conversion and not a scaling fudge.
 * 6,500 Btu/kWh at $3.50/MMBtu is $0.02275/kWh.
 */
export function fuelCostPerKwh(fuel: FuelInput | null): number | null {
  if (!fuel) return null
  const { heatRate, gasPricePerMmbtu } = fuel
  if (heatRate == null || gasPricePerMmbtu == null) return null
  if (!Number.isFinite(heatRate) || !Number.isFinite(gasPricePerMmbtu)) return null
  return (heatRate * gasPricePerMmbtu) / 1_000_000
}

export interface AnnualCostArgs {
  costs: LineCosts
  /** Facility megawatts the line draws, for fixed O&M priced per kW-year. */
  mw: number | null
  /** Annual energy, for variable O&M and fuel. */
  energyMwh: number | null
}

export interface AnnualCostResult {
  total: number | null
  fixedOm: number | null
  variableOm: number | null
  fuel: number | null
  flat: number | null
  /** Which components could not be computed, and why, for the reader. */
  missing: string[]
}

/**
 * Annual operating cost from whichever components are present.
 *
 * ⚠ ABSENT IS NOT ZERO. A line with no cost entered returns `total: null`, so a
 * margin cannot be computed from it and no warning claims a healthy one. Only a
 * component that was actually entered contributes, and the components that were
 * needed but missing are named.
 */
export function annualCost(args: AnnualCostArgs): AnnualCostResult {
  const { costs, mw, energyMwh } = args
  const missing: string[] = []

  let fixedOm: number | null = null
  if (costs.fixedOmPerKwYear != null && Number.isFinite(costs.fixedOmPerKwYear)) {
    if (mw == null) missing.push('MW, needed for fixed O&M per kW-year')
    else fixedOm = mwToKw(mw) * costs.fixedOmPerKwYear
  }

  let variableOm: number | null = null
  if (costs.variableOmPerMwh != null && Number.isFinite(costs.variableOmPerMwh)) {
    if (energyMwh == null) missing.push('Annual energy, needed for variable O&M per MWh')
    else variableOm = energyMwh * costs.variableOmPerMwh
  }

  const perKwh = fuelCostPerKwh(costs.fuel)
  let fuel: number | null = null
  if (perKwh != null) {
    if (energyMwh == null) missing.push('Annual energy, needed for fuel cost')
    else fuel = energyMwh * 1000 * perKwh
  }

  const flat =
    costs.opexAnnual != null && Number.isFinite(costs.opexAnnual) ? costs.opexAnnual : null

  const parts = [fixedOm, variableOm, fuel, flat].filter((v): v is number => v != null)
  return {
    total: parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null,
    fixedOm,
    variableOm,
    fuel,
    flat,
    missing,
  }
}

/** Net operating income: revenue less operating cost. Null when cost is unknown. */
export function noi(annualRevenue: number | null, annualOpex: number | null): number | null {
  if (annualRevenue == null) return null
  if (annualOpex == null) return null
  return annualRevenue - annualOpex
}

/**
 * Capitalized value of a stabilized NOI.
 *
 * $30M at a 6.3% cap rate is about $476.2M. Null when either input is absent:
 * there is no default cap rate, and a zero or negative rate is refused rather
 * than returning an infinity that would render as a very large deal.
 */
export function assetValue(stabilizedNoi: number | null, capRatePct: number | null): number | null {
  if (stabilizedNoi == null || capRatePct == null) return null
  if (!Number.isFinite(stabilizedNoi) || !Number.isFinite(capRatePct)) return null
  if (capRatePct <= 0) return null
  return stabilizedNoi / (capRatePct / 100)
}

/** Energy at full output for a nameplate, used by capacity-factor style checks. */
export function maxAnnualEnergyMwh(mw: number): number {
  return mw * HOURS_PER_YEAR
}
