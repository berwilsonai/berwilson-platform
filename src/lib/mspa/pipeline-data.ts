/**
 * Part G — TensorIQ's stated pipeline, stored as REFERENCE DATA.
 *
 * ⚠ THIS IS WHAT THEY TOLD US, NOT WHAT WE BELIEVE. Every figure here is
 * transcribed from the pipeline report Jonathan Houk sent on 2026-10-14 and the
 * tearsheet Sterling Orr sent on 2026-10-15. The percentages are theirs and
 * carry no definition — `confidenceNote` says so on every row, and nothing in
 * this codebase converts one into a probability or weights a figure by it.
 *
 * Pure data. No imports.
 */

/** What TensorIQ's own percentage means. The answer is: nobody has said. */
export const CONFIDENCE_NOTE =
  'TensorIQ stated confidence, definition unconfirmed — not a probability, and never used to weight a figure.'

export interface PipelineRow {
  label: string
  /** TensorIQ's bare percentage. Stored, never interpreted. */
  statedConfidencePct: number
  /** Direct MW where stated. */
  mw: number | null
  /** The unit exactly as printed, so a GW error survives into the flag. */
  unit: 'MW' | 'GW' | null
  state: string | null
  gpuGeneration: string | null
  critical: boolean
}

/** The 16 tracked opportunities, as printed. */
export const TENSORIQ_PIPELINE: readonly PipelineRow[] = [
  { label: 'TX-74 BG300', statedConfidencePct: 100, mw: 74, unit: 'MW', state: 'TX', gpuGeneration: 'BG300', critical: true },
  { label: 'StratGrid R-200', statedConfidencePct: 100, mw: null, unit: null, state: null, gpuGeneration: 'R-200', critical: true },
  { label: 'PA R-200', statedConfidencePct: 95, mw: null, unit: null, state: 'PA', gpuGeneration: 'R-200', critical: true },
  { label: 'Arc Light B300', statedConfidencePct: 95, mw: null, unit: null, state: null, gpuGeneration: 'B300', critical: true },
  { label: 'Unicom B-300', statedConfidencePct: 95, mw: null, unit: null, state: 'NJ', gpuGeneration: 'B-300', critical: true },
  { label: 'Netherlands', statedConfidencePct: 90, mw: 0.5, unit: 'MW', state: null, gpuGeneration: null, critical: false },
  { label: 'Big Digital Energy 4MW', statedConfidencePct: 90, mw: 4, unit: 'MW', state: null, gpuGeneration: null, critical: false },
  { label: 'Arthur Inc. 23MW OH', statedConfidencePct: 80, mw: 23, unit: 'MW', state: 'OH', gpuGeneration: null, critical: false },
  { label: 'Arthur Inc. 7 sites', statedConfidencePct: 75, mw: null, unit: null, state: null, gpuGeneration: null, critical: false },
  { label: 'Tower Digital 10MW plus 2 x 4MW', statedConfidencePct: 75, mw: 18, unit: 'MW', state: null, gpuGeneration: null, critical: false },
  { label: 'Container RTX-6000/H-100', statedConfidencePct: 75, mw: null, unit: null, state: null, gpuGeneration: 'RTX-6000/H-100', critical: false },
  { label: 'Howard Hughes Medical Center R200', statedConfidencePct: 50, mw: null, unit: null, state: 'MD', gpuGeneration: 'R200', critical: false },
  { label: 'West Virginia', statedConfidencePct: 25, mw: null, unit: null, state: 'WV', gpuGeneration: null, critical: false },
  { label: 'South Carolina 3 properties', statedConfidencePct: 25, mw: 130, unit: 'MW', state: 'SC', gpuGeneration: null, critical: false },
  { label: 'ANAX Power 1MW NJ', statedConfidencePct: 25, mw: 1, unit: 'MW', state: 'NJ', gpuGeneration: null, critical: false },
  { label: 'ANAX Power 2MW PA', statedConfidencePct: 25, mw: 2, unit: 'MW', state: 'PA', gpuGeneration: null, critical: false },
]

/** The summary figures printed on the same report. */
export const TENSORIQ_PIPELINE_SUMMARY = {
  trackedOpportunities: 16,
  criticalOpportunities: 5,
  gpusLow: 35_694,
  gpusHigh: 36_734,
  mwLow: 73.3,
  mwHigh: 93.4,
  modeledRevenueLow: 1_400_360_460,
  modeledRevenueHigh: 3_141_616_320,
  revenueNote:
    'TensorIQ labels these scenario outputs, not forecasts, and says the figures mix contract value for stated multi-year terms with annual run-rate otherwise — so the low and high are not the same quantity.',
} as const

/**
 * The map slide's claims, which is where the unit and place errors live.
 *
 * ⚠ THESE DO NOT RECONCILE WITH THE PIPELINE ABOVE. The same report claims
 * "a total of 3,867 MW of powered projects in the United States" while its own
 * tracked pipeline is 73.3-93.4 MW. `flagPortfolioReconciliation` raises it.
 */
export const TENSORIQ_MAP_CLAIMS: readonly PipelineRow[] = [
  { label: 'Allentown, PA', statedConfidencePct: 0, mw: 120, unit: 'MW', state: 'PA', gpuGeneration: null, critical: false },
  { label: 'Houston, TX', statedConfidencePct: 0, mw: 800, unit: 'MW', state: 'TX', gpuGeneration: null, critical: false },
  { label: 'Hood County, TX', statedConfidencePct: 0, mw: 17, unit: 'MW', state: 'TX', gpuGeneration: null, critical: false },
  // ⚠ 800 GW is roughly two-thirds of total US generating capacity.
  { label: 'Western, WV', statedConfidencePct: 0, mw: 800, unit: 'GW', state: 'WV', gpuGeneration: null, critical: false },
  { label: 'South Carolina', statedConfidencePct: 0, mw: 130, unit: 'MW', state: 'SC', gpuGeneration: null, critical: false },
  // ⚠ There is no Newport, Alaska. Newport, Arkansas is real.
  { label: 'Newport, AK', statedConfidencePct: 0, mw: 140, unit: 'MW', state: 'AK', gpuGeneration: null, critical: false },
  { label: 'Uniontown, PA', statedConfidencePct: 0, mw: 4, unit: 'MW', state: 'PA', gpuGeneration: null, critical: false },
  // ⚠ Calgary is in Alberta. "CA" reads as California in a US state column.
  { label: 'Calgary, CA', statedConfidencePct: 0, mw: 2000, unit: 'MW', state: 'CA', gpuGeneration: null, critical: false },
]

export const TENSORIQ_PORTFOLIO_CLAIM_MW = 3867

/** TensorIQ's four funding phases, in their order. */
export const TENSORIQ_PHASES: readonly { n: number; label: string; detail: string }[] = [
  { n: 1, label: 'Planning', detail: 'Scope, plan, MEP and site design, power agreement with a date certain' },
  { n: 2, label: 'Construction', detail: 'Build to a powered shell' },
  { n: 3, label: 'AI Factory installation', detail: 'GPUs, fabric, cooling' },
  { n: 4, label: 'Client onboarding', detail: 'Tenant live' },
]

/**
 * ⚠ THE PREPAYMENT IS A DEPENDENCY, NOT A GIVEN, AND TENSORIQ'S OWN PROCESS
 * SAYS SO. The model funds roughly $1.9B of working capital from a customer
 * prepayment struck at 25% of five-year contract value. But their own phase
 * gate says no client letter of intent can be signed until planning is complete
 * and power has a date certain — so the prepayment cannot exist at the point
 * the model draws on it.
 */
export const PREPAYMENT_DEPENDENCY_NOTE =
  'The ~$1.9B customer prepayment is 25% of five-year contract value and funds most of the equity gap. TensorIQ’s own process bars a client letter of intent until planning is complete and power has a date certain, so the prepayment cannot be available as early as the model assumes. Treat it as a dependency.'

/** Excluded from every case, including the base. */
export const PLATFORM_REVENUE_EXCLUSION_NOTE =
  'The Platform and Software tab (MisaLabs resale) is excluded from every case. Its own warning says the signed agreement bars resale and hosting, and the reseller agreement it relies on does not exist. Contractually barred revenue is zero, not a haircut.'

/** Elite Solutions' commission, which is not a project fee at all. */
export const ELITE_COMMISSION_PCT = 1.5
export const ELITE_COMMISSION_NOTE =
  'Elite Solutions earns 1.5% of total AVANT Ecosystem commissions on Internal Technology Systems, paid only from provider-funded commissions. It is not a project fee, is not charged to Ber Wilson, TensorIQ or the owner, and Internal Technology Systems exclude Core Compute Infrastructure. ⚠ The commission base is unconfirmed — 1.5% a year of the internals CAPITAL value is about two orders of magnitude from 1.5% of its annual revenue.'
