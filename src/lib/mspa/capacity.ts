/**
 * Capacity, and the unit trap that makes every other number in this folder
 * wrong when it is got wrong.
 *
 * ⚠ A BARE MEGAWATT FIGURE IS NOT AN INPUT. "900 MW" means 900 IT MW (1,260
 * utility MW at PUE 1.4) or 900 utility MW (643 IT MW at the same PUE), and
 * the two readings differ by a factor of two in every fee, every cost and
 * every return downstream. The Project Collaboration Agreement defines Planned
 * IT Capacity as IT load; a figure quoted by a city or a utility is almost
 * always total draw. So `MwFigure` carries its basis and there is no way to
 * construct one without saying which it is — a missing basis is a FLAG, never
 * a guess (see `flags.ts`).
 *
 * Pure arithmetic, sibling imports only. Safe for a verification script.
 */

/** Which load a megawatt figure is measured at. */
export type MwBasis = 'it' | 'utility'

export const MW_BASIS_LABELS: Record<MwBasis, string> = {
  it: 'IT load',
  utility: 'Utility load',
}

/** Heat rejection architecture. Sets PUE and square feet per MW. */
export type CoolingType = 'dlc' | 'immersion'

export const COOLING_LABELS: Record<CoolingType, string> = {
  dlc: 'Direct liquid cooling',
  immersion: 'Immersion',
}

/**
 * TensorIQ model defaults. These are THEIR assumptions, carried so our numbers
 * can be compared against theirs, and marked as defaults wherever they surface.
 */
export const PUE_BY_COOLING: Record<CoolingType, number> = {
  dlc: 1.4,
  immersion: 1.2,
}

/** Gross floor area per utility MW, by cooling type. */
export const SQFT_PER_UTILITY_MW: Record<CoolingType, number> = {
  dlc: 2400,
  immersion: 1250,
}

/**
 * The cooling clock derate. A thermally limited part draws less than its TDP,
 * so DLC draws 0.95 of nameplate; immersion runs at 1.00. To reach the SAME
 * compute, GPU count scales by 1 / clock.
 */
export const COOLING_CLOCK: Record<CoolingType, number> = {
  dlc: 0.95,
  immersion: 1.0,
}

/** A megawatt figure that knows which load it measures. */
export interface MwFigure {
  mw: number
  basis: MwBasis
}

export function utilityMwFromIt(itMw: number, pue: number): number {
  return itMw * pue
}

export function itMwFromUtility(utilityMw: number, pue: number): number {
  return utilityMw / pue
}

/** Both readings of a capacity figure, so a screen can always show both. */
export interface ResolvedCapacity {
  itMw: number
  utilityMw: number
  pue: number
  /** The basis the figure was entered on. The other number is derived. */
  statedBasis: MwBasis
  /** Cooling MW: the difference, which the cooling electrical cost is priced on. */
  coolingMw: number
}

/**
 * Resolve a capacity figure to both bases.
 *
 * `pue` is taken from the cooling type unless overridden. Passing a PUE below 1
 * is impossible physically (a facility cannot draw less than its IT load), so
 * it throws rather than returning a plausible number.
 */
export function resolveCapacity(
  figure: MwFigure,
  cooling: CoolingType,
  pueOverride?: number | null
): ResolvedCapacity {
  const pue = pueOverride ?? PUE_BY_COOLING[cooling]
  if (!Number.isFinite(pue) || pue < 1) {
    throw new Error(`PUE must be at least 1.0; got ${pue}`)
  }
  if (!Number.isFinite(figure.mw) || figure.mw < 0) {
    throw new Error(`MW must be a non-negative number; got ${figure.mw}`)
  }
  const itMw = figure.basis === 'it' ? figure.mw : itMwFromUtility(figure.mw, pue)
  const utilityMw = figure.basis === 'it' ? utilityMwFromIt(figure.mw, pue) : figure.mw
  return {
    itMw,
    utilityMw,
    pue,
    statedBasis: figure.basis,
    coolingMw: utilityMw - itMw,
  }
}

/** Gross floor area implied by a utility load. */
export function floorAreaSqft(utilityMw: number, cooling: CoolingType): number {
  return utilityMw * SQFT_PER_UTILITY_MW[cooling]
}

/**
 * Both readings of an unconfirmed figure, for a screen that has to show the
 * ambiguity rather than resolve it.
 */
export function bothReadings(
  mw: number,
  cooling: CoolingType,
  pueOverride?: number | null
): { asIt: ResolvedCapacity; asUtility: ResolvedCapacity } {
  return {
    asIt: resolveCapacity({ mw, basis: 'it' }, cooling, pueOverride),
    asUtility: resolveCapacity({ mw, basis: 'utility' }, cooling, pueOverride),
  }
}
