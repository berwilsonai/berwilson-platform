/**
 * Unit conversion for the deal economics engine.
 *
 * ⚠ EVERY PRICE IN THIS ENGINE CARRIES ITS UNIT. A megawatt is not a kilowatt
 * and $/kW-month is not $/kW-year, and the two mistakes this module exists to
 * prevent are both silent: a thousand-fold error reads as a plausible number on
 * a screen full of large numbers, and a twelve-fold error on a data center
 * lease rate reads as a very good deal. Nothing in here assumes a unit; a
 * caller that does not state one gets null back, not a guess.
 *
 * Pure arithmetic, no imports. Safe for a verification script to load.
 */

/**
 * Hours in a year, fixed at the non-leap figure.
 *
 * The brief permits ignoring the 8,784 hours of a leap year and asks only for
 * consistency, so this is the one constant every annualisation uses. Changing
 * it changes every energy figure in the platform, which is why it is named once
 * and never inlined.
 */
export const HOURS_PER_YEAR = 8760

export const MONTHS_PER_YEAR = 12

/** 1 MW = 1,000 kW. 1 MWh = 1,000 kWh. */
export const KW_PER_MW = 1000

export type EnergyPriceUnit = 'per_kwh' | 'per_mwh'
export type CapacityPriceUnit = 'per_kw_month' | 'per_kw_year' | 'per_mw_year'
export type LandPriceUnit = 'per_acre' | 'per_mw'

export const ENERGY_PRICE_UNITS: readonly EnergyPriceUnit[] = ['per_kwh', 'per_mwh']
export const CAPACITY_PRICE_UNITS: readonly CapacityPriceUnit[] = [
  'per_kw_month',
  'per_kw_year',
  'per_mw_year',
]
export const LAND_PRICE_UNITS: readonly LandPriceUnit[] = ['per_acre', 'per_mw']

export const ENERGY_PRICE_UNIT_LABELS: Record<EnergyPriceUnit, string> = {
  per_kwh: '$/kWh',
  per_mwh: '$/MWh',
}

export const CAPACITY_PRICE_UNIT_LABELS: Record<CapacityPriceUnit, string> = {
  per_kw_month: '$/kW-month',
  per_kw_year: '$/kW-year',
  per_mw_year: '$/MW-year',
}

export const LAND_PRICE_UNIT_LABELS: Record<LandPriceUnit, string> = {
  per_acre: '$/acre',
  per_mw: '$/MW',
}

export function mwToKw(mw: number): number {
  return mw * KW_PER_MW
}

export function kwToMw(kw: number): number {
  return kw / KW_PER_MW
}

export function mwhToKwh(mwh: number): number {
  return mwh * KW_PER_MW
}

export function kwhToMwh(kwh: number): number {
  return kwh / KW_PER_MW
}

/** Normalise an energy price to dollars per kWh, the engine's internal unit. */
export function energyPricePerKwh(price: number, unit: EnergyPriceUnit): number {
  return unit === 'per_mwh' ? price / KW_PER_MW : price
}

/** Normalise an energy price to dollars per MWh, for display beside volumes. */
export function energyPricePerMwh(price: number, unit: EnergyPriceUnit): number {
  return unit === 'per_kwh' ? price * KW_PER_MW : price
}

/**
 * Normalise a capacity or service price to dollars per kW-month.
 *
 * $/MW-year divides by 1,000 to reach kW and by 12 to reach a month, so a rate
 * entered in the wrong one of these three is out by 12x or 12,000x. `warnings`
 * carries the band check that catches the common case.
 */
export function capacityPricePerKwMonth(price: number, unit: CapacityPriceUnit): number {
  if (unit === 'per_kw_month') return price
  if (unit === 'per_kw_year') return price / MONTHS_PER_YEAR
  return price / KW_PER_MW / MONTHS_PER_YEAR
}

/** Annual energy in MWh from an average load and a load factor. */
export function annualEnergyMwh(mw: number, loadFactor: number): number {
  return mw * HOURS_PER_YEAR * loadFactor
}

/**
 * The average megawatts implied by a year's energy.
 *
 * ⚠ NO LOAD FACTOR IS APPLIED HERE, AND THAT IS THE WHOLE POINT. Reverse mode
 * answers "what average load does this revenue imply", which is energy spread
 * over every hour of the year. Dividing by a load factor as well would double
 * count it: the four Stockton lines total 115.5 MW against 150 firm only
 * because this is a plain division.
 */
export function impliedAverageMw(energyMwh: number): number {
  return energyMwh / HOURS_PER_YEAR
}

/** Facility load drawn by an IT load at a given PUE. */
export function facilityMwFromItMw(itMw: number, pue: number): number {
  return itMw * pue
}

/** IT capacity available inside a facility load at a given PUE. */
export function itMwFromFacilityMw(facilityMw: number, pue: number): number {
  return facilityMw / pue
}

/** A percentage (0 to 100) as a fraction. Null and non-finite pass through as null. */
export function pctToFraction(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct)) return null
  return pct / 100
}
