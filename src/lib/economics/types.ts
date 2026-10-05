/**
 * The shapes a deal's economics is described in.
 *
 * One megawatt is not one number and money does not come in one shape. The two
 * unions in this file are the whole discipline: a capacity figure always says
 * which of nameplate / firm / allocated / IT it is, and a money figure always
 * says whether it is recurring, a contract total, one-time, an asset value or
 * Ber Wilson's own capture. Nothing in this engine ever returns an unlabelled
 * "deal value".
 *
 * ⚠ Every line type is discriminated on `type` alone, which is unique per arm.
 * A union whose arms share a property name cannot be narrowed by that property
 * (CLAUDE.md §12), so nothing else is used to tell them apart.
 *
 * Pure types plus small literal arrays. No imports beyond sibling type modules,
 * so a verification script can load it.
 */

import type { Provenance, ProvenanceStatus } from './provenance'
import type { CapacityPriceUnit, EnergyPriceUnit, LandPriceUnit } from './units'

// ───────────────────────────────────────────────────────────── capacity ledger

export type CapacitySourceKind = 'grid_interconnect' | 'onsite_generation' | 'storage'

export const CAPACITY_SOURCE_KINDS: readonly CapacitySourceKind[] = [
  'grid_interconnect',
  'onsite_generation',
  'storage',
]

export const CAPACITY_SOURCE_LABELS: Record<CapacitySourceKind, string> = {
  grid_interconnect: 'Grid interconnect',
  onsite_generation: 'On-site generation',
  storage: 'Storage',
}

/**
 * Where megawatts come from.
 *
 * A source is described EITHER by a plain nameplate figure or by a block
 * design. A block design is the N+X case: 24 fuel cell blocks of 50 MW with 4
 * held redundant is 1,000 MW firm, not 1,200. `statedNetMw` is what a document
 * or a counterparty asserts the net figure is, kept beside the derived one
 * rather than replacing it so a disagreement surfaces instead of being settled
 * silently (the same doctrine as `project_parcels.acres` vs `assessor_acres`).
 */
export interface CapacitySource {
  id: string
  label: string
  kind: CapacitySourceKind
  /** Total installed capacity. Ignored when a complete block design is given. */
  nameplateMw: number | null
  /** 0 to 100. Null means no derate is claimed, not zero availability. */
  availabilityPct: number | null
  blockCount: number | null
  redundantBlocks: number | null
  blockMw: number | null
  /** What someone else says the net figure is. Compared, never applied. */
  statedNetMw: number | null
  status: ProvenanceStatus
}

/**
 * An allocation bucket. The priority order the brief specifies is seeded as
 * `DEFAULT_BUCKETS`; a user may add their own, so this is data, never an enum.
 */
export interface CapacityBucket {
  id: string
  label: string
  /** Lower sorts first. The brief's order is local load through to surplus. */
  priority: number
  /** Measured or designed peak, when known. Compared against firm MW. */
  peakMw: number | null
}

export const DEFAULT_BUCKETS: readonly Omit<CapacityBucket, 'id'>[] = [
  { label: 'Local and retail load', priority: 10, peakMw: null },
  { label: 'Development load', priority: 20, peakMw: null },
  { label: 'Anchor and critical load', priority: 30, peakMw: null },
  { label: 'Data center facility load', priority: 40, peakMw: null },
  { label: 'Storage and resilience', priority: 50, peakMw: null },
  { label: 'Reserve margin', priority: 60, peakMw: null },
  { label: 'Surplus for external sale', priority: 70, peakMw: null },
]

// ────────────────────────────────────────────────────────────────────── money

/**
 * The shape of a sum of money. These must never be added together or allowed
 * to stand in for one another: a $500M project where Ber Wilson earns a $20M
 * fee is a $20M deal to Ber Wilson.
 */
export type MoneyShape = 'recurring' | 'contract' | 'one_time' | 'asset' | 'capture'

export const MONEY_SHAPE_LABELS: Record<MoneyShape, string> = {
  recurring: 'Annual recurring revenue',
  contract: 'Contract value over term',
  one_time: 'One-time revenue',
  asset: 'Stabilized asset value',
  capture: 'Ber Wilson capture',
}

// ──────────────────────────────────────────────────────────── the SPV roster

export type SpvPurpose = 'land' | 'energy' | 'data_center' | 'housing' | 'other'

export const SPV_PURPOSES: readonly SpvPurpose[] = [
  'land',
  'energy',
  'data_center',
  'housing',
  'other',
]

export const SPV_PURPOSE_LABELS: Record<SpvPurpose, string> = {
  land: 'Land',
  energy: 'Energy',
  data_center: 'Data center',
  housing: 'Housing',
  other: 'Other',
}

/** The three a project is offered by default. Housing and Other are available. */
export const DEFAULT_SPV_PURPOSES: readonly SpvPurpose[] = ['land', 'energy', 'data_center']

/**
 * A liability-siloed vehicle inside a deal, and Ber Wilson's share of it.
 *
 * `bwOwnershipPct` is nullable on purpose. Financing partners will take
 * ownership inside these SPVs and nobody knows the splits yet, so an unset
 * split must leave the model VALID. What it must not do is let an unknown share
 * read as 100%: lines owned by an SPV with no split are reported separately as
 * undetermined rather than folded into the net figure.
 */
export interface Spv {
  id: string
  label: string
  purpose: SpvPurpose
  /** The legal entity in the directory, when one has been created. */
  entityId: string | null
  /** 0 to 100, or null for "not yet determined". */
  bwOwnershipPct: number | null
  status: ProvenanceStatus
}

// ─────────────────────────────────────────────────────────── revenue lines

export type RevenueLineType =
  // draw megawatts from a bucket
  | 'energy_sale'
  | 'capacity_charge'
  | 'dc_lease'
  | 'subscription'
  | 'om_service'
  // draw nothing
  | 'energy_attribute'
  | 'recurring_fee_on_line'
  // one-time
  | 'one_time_per_mw'
  | 'one_time_per_unit'
  | 'one_time_lump'
  | 'tax_credit'
  | 'land'
  // derived
  | 'fee_margin'

export const REVENUE_LINE_TYPES: readonly RevenueLineType[] = [
  'energy_sale',
  'capacity_charge',
  'dc_lease',
  'subscription',
  'om_service',
  'energy_attribute',
  'recurring_fee_on_line',
  'one_time_per_mw',
  'one_time_per_unit',
  'one_time_lump',
  'tax_credit',
  'land',
  'fee_margin',
]

export const REVENUE_LINE_LABELS: Record<RevenueLineType, string> = {
  energy_sale: 'Energy sale',
  capacity_charge: 'Capacity or demand charge',
  dc_lease: 'Data center lease',
  subscription: 'Subscription',
  om_service: 'O&M or service agreement',
  energy_attribute: 'Environmental attributes',
  recurring_fee_on_line: 'Recurring fee on another line',
  one_time_per_mw: 'One-time per MW',
  one_time_per_unit: 'One-time per unit',
  one_time_lump: 'One-time lump sum',
  tax_credit: 'Tax credit',
  land: 'Land',
  fee_margin: 'Fee or margin on another line',
}

/** The types that consume megawatts. `land` is conditional on its pricing basis. */
export const DRAWING_LINE_TYPES: readonly RevenueLineType[] = [
  'energy_sale',
  'capacity_charge',
  'dc_lease',
  'subscription',
]

/** The types whose value is a percentage of another line. Evaluated last. */
export const DERIVED_LINE_TYPES: readonly RevenueLineType[] = [
  'energy_attribute',
  'recurring_fee_on_line',
  'fee_margin',
]

export interface FuelInput {
  /** Btu per kWh. */
  heatRate: number | null
  /** Dollars per MMBtu. */
  gasPricePerMmbtu: number | null
}

/** Operating cost, so a line can report NOI or net margin rather than revenue. */
export interface LineCosts {
  /** A flat annual figure, when that is all anyone knows. */
  opexAnnual: number | null
  fixedOmPerKwYear: number | null
  variableOmPerMwh: number | null
  fuel: FuelInput | null
}

export const NO_COSTS: LineCosts = {
  opexAnnual: null,
  fixedOmPerKwYear: null,
  variableOmPerMwh: null,
  fuel: null,
}

export interface LineBase {
  id: string
  label: string
  /** The SPV that earns this line. Null means the parent company. */
  spvId: string | null
  /**
   * Whether this line is Ber Wilson's revenue at all.
   *
   * False is the common case on a large deal: a $3.5B internals package built
   * by a partner is revenue generated at the project and none of it is ours.
   * Fee and margin line types are capture regardless of this flag.
   */
  isBerWilsonRevenue: boolean
  /** Line-level provenance, the default for any field with no row of its own. */
  status: ProvenanceStatus
  /**
   * Per-field provenance, keyed by the field name as the UI labels it.
   *
   * One concept, not two: the status a field inherits and the source it came
   * from are the same record, so a stale benchmark can be found by the warning
   * layer without a second lookup.
   */
  fields?: Record<string, Provenance>
  costs: LineCosts
  notes?: string | null
}

export interface RecurringBase extends LineBase {
  /** Calendar year of commercial operation, or null when undecided. */
  startYear: number | null
  termYears: number | null
  /** Percent per year, compounding from year 2. */
  escalatorPct: number | null
  /**
   * Per-year multipliers on the base figure, year 1 first. Shorter than the
   * term is fine: the last value carries. Null means no ramp.
   */
  ramp: number[] | null
}

export interface ScheduleEntry {
  label: string
  pct: number
  /** `YYYY-MM-DD`, or null when only `monthsFromNtp` is known. */
  date: string | null
  monthsFromNtp: number | null
}

export interface EnergySaleLine extends RecurringBase {
  type: 'energy_sale'
  bucketId: string | null
  /**
   * Forward prices a known load. Reverse starts from a revenue target and
   * reports the load it implies, which is how the existing proposals are
   * written and the only way to reconcile them against a ledger.
   */
  mode: 'forward' | 'reverse'
  mw: number | null
  /** 0 to 1. How much of the allocated MW is actually consumed on average. */
  loadFactor: number | null
  price: number | null
  priceUnit: EnergyPriceUnit
  /** Reverse mode only. */
  targetAnnualRevenue: number | null
  /** Take-or-pay floor as a percent of contracted volume, when one exists. */
  minimumTakePct: number | null
}

export interface CapacityChargeLine extends RecurringBase {
  type: 'capacity_charge'
  bucketId: string | null
  mw: number | null
  price: number | null
  priceUnit: CapacityPriceUnit
}

export interface DcLeaseLine extends RecurringBase {
  type: 'dc_lease'
  bucketId: string | null
  /** Critical IT load. The ledger draws `itMw * pue` as facility load. */
  itMw: number | null
  ratePerKwMonth: number | null
  /** 0 to 1 at stabilization. The ramp carries the lease-up. */
  occupancy: number | null
  pue: number | null
  /**
   * When power is passed through to the tenant it is not revenue to the lessor.
   * The flag exists so a model that does keep it says so deliberately.
   */
  powerPassedThrough: boolean
  powerRevenueRetained: boolean
}

export interface SubscriptionLine extends RecurringBase {
  type: 'subscription'
  bucketId: string | null
  units: number | null
  pricePerUnitMonth: number | null
  unitLabel: string | null
  /** Facility load this subscription base draws, when it draws any. */
  mw: number | null
}

/**
 * A recurring agreement to operate and maintain the plant after COD.
 *
 * ⚠ IT DRAWS NO MEGAWATTS, AND THIS IS NOT A DETAIL. Its `mw` is the capacity
 * the fee is PRICED on, not load it consumes: maintaining a 125 MW plant does
 * not take 125 MW off that plant. Treating it as a draw double-books the
 * generation against itself, which is exactly what happened the first time a
 * full campus was modelled: 290 MW allocated against 225 MW firm, and the
 * ledger correctly refused a model that was only wrong about one line type.
 */
export interface OmServiceLine extends RecurringBase {
  type: 'om_service'
  /** The capacity the fee is priced on. Not an allocation. */
  mw: number | null
  price: number | null
  priceUnit: CapacityPriceUnit
  counterparty: string | null
}

export interface EnergyAttributeLine extends RecurringBase {
  type: 'energy_attribute'
  /**
   * The energy line whose volume this rides on. Draws ZERO megawatts: the same
   * electrons earn an attribute and an energy payment, and a second claim on
   * the ledger would be rejected as a double allocation.
   */
  ridesOnLineId: string | null
  pricePerMwh: number | null
  attributeKind: string | null
}

export type FeeBase = 'referenced_line_value' | 'referenced_line_annual_revenue' | 'capital_base'

export const FEE_BASES: readonly FeeBase[] = [
  'referenced_line_value',
  'referenced_line_annual_revenue',
  'capital_base',
]

export const FEE_BASE_LABELS: Record<FeeBase, string> = {
  referenced_line_value: "The referenced line's total value",
  referenced_line_annual_revenue: "The referenced line's annual revenue",
  capital_base: 'A capital figure entered here',
}

/**
 * A recurring percentage of a declared base, times our share of it.
 *
 * ⚠ THE BASE IS A FIELD, NEVER A CONVENTION. 1.5% a year of a $3.5B capital
 * package and 1.5% a year of its annual revenue differ by two orders of
 * magnitude, so the screen asks rather than the engine guessing. Elite
 * Solutions / Avant is the worked case: an internals line at about $17.5M/MW
 * over 200 MW, then this line at 1.5% a year against that line's value with
 * `ourSharePct` 50.
 */
export interface RecurringFeeOnLineLine extends RecurringBase {
  type: 'recurring_fee_on_line'
  referencedLineId: string | null
  base: FeeBase
  /** Used only when `base` is `capital_base`. */
  capitalBase: number | null
  annualRatePct: number | null
  /** Our share of the fee, 0 to 100. 50 for a half split with a partner. */
  ourSharePct: number | null
  partnerLabel: string | null
  /** See `isCarveOut` on `FeeMarginLine`. A commission is normally paid on top. */
  isCarveOut: boolean
}

export interface OneTimeBase extends LineBase {
  /** Percentages must total 100, or the line is invalid. */
  schedule: ScheduleEntry[] | null
  /**
   * Whether this counts toward total project value, the capex view of the deal.
   * A build contract does; a tax credit and a land sale do not.
   */
  countsTowardProjectValue: boolean
}

export interface OneTimePerMwLine extends OneTimeBase {
  type: 'one_time_per_mw'
  mw: number | null
  pricePerMw: number | null
  costPerMw: number | null
}

export interface OneTimePerUnitLine extends OneTimeBase {
  type: 'one_time_per_unit'
  quantity: number | null
  pricePerUnit: number | null
  costPerUnit: number | null
  /** Homes, lots, tons, square feet, pads. Required: it labels the figure. */
  unitLabel: string | null
}

export interface OneTimeLumpLine extends OneTimeBase {
  type: 'one_time_lump'
  amount: number | null
  cost: number | null
}

export type TaxCreditKind = '48E' | '45X' | '45Q' | 'other'

export const TAX_CREDIT_KINDS: readonly TaxCreditKind[] = ['48E', '45X', '45Q', 'other']

/**
 * A credit is money and is not revenue. It reaches deal size and the capex
 * view without inflating any revenue figure, which is why it carries its own
 * type rather than being a lump sum with a note.
 */
export interface TaxCreditLine extends OneTimeBase {
  type: 'tax_credit'
  amount: number | null
  kind: TaxCreditKind
  transferable: boolean
  /** Our share after any transfer or syndication, 0 to 100. */
  ourSharePct: number | null
}

export interface LandLine extends OneTimeBase {
  type: 'land'
  /** Sale is one-time. Lease is recurring rent with an escalator. */
  disposition: 'sale' | 'lease'
  acres: number | null
  mw: number | null
  price: number | null
  priceUnit: LandPriceUnit
  /** Lease only. */
  annualRent: number | null
  escalatorPct: number | null
  termYears: number | null
  startYear: number | null
  /** Powered land priced per MW allocates those MW. Per-acre land does not. */
  bucketId: string | null
}

/** A one-shot percentage of another line: EPC margin, developer fee, supply margin. */
export interface FeeMarginLine extends LineBase {
  type: 'fee_margin'
  referencedLineId: string | null
  pctOfLine: number | null
  /**
   * Whether this fee is a SLICE of the referenced line or money paid ON TOP of
   * it.
   *
   * ⚠ GETTING THIS WRONG DOUBLE COUNTS THE DEAL. EPC margin is a carve-out:
   * the $18M we earn is already inside the $150M contract, so gross revenue
   * generated at the project is $150M, not $168M. A partner commission paid by
   * the owner is not a carve-out: it is incremental money and belongs in the
   * gross. One is true of margins and the other of commissions, so this is a
   * field the screen asks about rather than a convention the engine assumes.
   */
  isCarveOut: boolean
}

export type RevenueLine =
  | EnergySaleLine
  | CapacityChargeLine
  | DcLeaseLine
  | SubscriptionLine
  | OmServiceLine
  | EnergyAttributeLine
  | RecurringFeeOnLineLine
  | OneTimePerMwLine
  | OneTimePerUnitLine
  | OneTimeLumpLine
  | TaxCreditLine
  | LandLine
  | FeeMarginLine

// ───────────────────────────────────────────────────────────── engine input

export interface DealEconomicsInput {
  sources: CapacitySource[]
  buckets: CapacityBucket[]
  lines: RevenueLine[]
  spvs: Spv[]
  /** Required for NPV. No default: a hidden discount rate is a hidden opinion. */
  discountRatePct: number | null
  /** Required for an asset value. No default. */
  capRatePct: number | null
  /** Year 1 of every schedule when a line does not state its own start. */
  baseYear: number | null
  /**
   * What a document or a conversation says the whole deal is worth, compared
   * against the sum of the lines so the unexplained remainder is named rather
   * than quietly absorbed.
   *
   * ⚠ IT CARRIES ITS SHAPE, AND THE SHAPE IS NOT OPTIONAL. Stockton's $152.5M
   * is an ANNUAL figure; comparing it against a contract value over a term
   * would report the whole of it as unattributed and the reconciliation would
   * be useless. Mixing an annual figure with a term total is the single
   * mistake this engine exists to prevent, so a stated total that does not say
   * which it is cannot be checked at all.
   */
  statedTotal: { amount: number; shape: MoneyShape } | null
}
