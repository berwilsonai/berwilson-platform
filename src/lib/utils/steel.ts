/**
 * Constants for the Prefab Steel CRM — deal stages, lead sources, and their
 * labels/badge styles. Stored as text in the DB (no Postgres enums), so this
 * file is the source of truth for the allowed values and how they render.
 */

// ─── Deal Stage ──────────────────────────────────────────────────────────────

export type SteelStage =
  | 'quote'
  | 'engineering'
  | 'order_placed'
  | 'delivered'
  | 'assembled'
  | 'invoiced'
  | 'paid'
  | 'lost'

export const STEEL_STAGES: SteelStage[] = [
  'quote', 'engineering', 'order_placed', 'delivered', 'assembled', 'invoiced', 'paid', 'lost',
]

// The steel CRM tracks a deal only as far as FRAME ASSEMBLY on the build side —
// even on deals where Ber Wilson builds the whole home, the rest of the build
// lives in the construction projects module, not here. 'assembled' is optional
// (a materials-only deal goes delivered → invoiced, skipping it); 'invoiced'
// marks that the customer has been billed, before payment lands.
/** Active pipeline stages, in order (excludes the off-ramp state). */
export const STEEL_PIPELINE: SteelStage[] = [
  'quote', 'engineering', 'order_placed', 'delivered', 'assembled', 'invoiced', 'paid',
]

export const STEEL_STAGE_LABELS: Record<SteelStage, string> = {
  quote: 'Quote',
  engineering: 'Engineering',
  order_placed: 'Order Placed',
  delivered: 'Delivered',
  assembled: 'Frame Assembly',
  invoiced: 'Invoiced',
  paid: 'Paid',
  lost: 'Lost',
}

export const STEEL_STAGE_INDEX: Record<SteelStage, number> = {
  quote: 0,
  engineering: 1,
  order_placed: 2,
  delivered: 3,
  assembled: 4,
  invoiced: 5,
  paid: 6,
  lost: -1,
}

export const STEEL_STAGE_BADGE: Record<SteelStage, string> = {
  quote: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  engineering: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  order_placed: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
  delivered: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30',
  assembled: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/30',
  invoiced: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  lost: 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
}

export const STEEL_STAGE_BORDER: Record<SteelStage, string> = {
  quote: 'border-l-blue-400',
  engineering: 'border-l-violet-400',
  order_placed: 'border-l-indigo-400',
  delivered: 'border-l-cyan-400',
  assembled: 'border-l-teal-400',
  invoiced: 'border-l-amber-400',
  paid: 'border-l-emerald-400',
  lost: 'border-l-red-300',
}

export function steelStage(value: string | null | undefined): SteelStage {
  return STEEL_STAGES.includes(value as SteelStage)
    ? (value as SteelStage)
    : 'quote'
}

export function isLostStage(value: string | null | undefined): boolean {
  return value === 'lost'
}

/** Deals still needing work: not paid, not lost. */
export function isOpenStage(value: string | null | undefined): boolean {
  return value !== 'paid' && value !== 'lost'
}

/**
 * A commission becomes a real PAYABLE only once the deal's cash is collected
 * (the deal reaches the 'paid' stage). Before that a commission is projected
 * (forecast) — computable, but not owed. This is the single trigger point for
 * "owed" across the app; to pay reps at invoice instead, add 'invoiced' here.
 */
export function isCommissionPayable(stage: string | null | undefined): boolean {
  return stage === 'paid'
}

// ─── Lead Source ─────────────────────────────────────────────────────────────
//
// Lead sources are a self-maintaining vocabulary, not a fixed list: the deal
// form suggests the defaults plus every source already in use, and typing a
// new one creates it. The display text is stored directly in
// steel_deals.lead_source (plain text column, no constraint).

export const DEFAULT_LEAD_SOURCES: string[] = [
  'Marketing', 'Team Referral', 'Architect Firm', 'Engineering Firm',
  'Existing Customer', 'Website', 'Trade Show', 'Other',
]

// The original fixed-vocab slugs (pre 2026-07-26), mapped for display in case
// a row predating the label migration is ever encountered.
const LEGACY_LEAD_SOURCE_LABELS: Record<string, string> = {
  marketing: 'Marketing',
  team_member: 'Team Referral',
  architect: 'Architect Firm',
  engineer: 'Engineering Firm',
  existing_customer: 'Existing Customer',
  website: 'Website',
  trade_show: 'Trade Show',
  other: 'Other',
}

export function leadSourceLabel(value: string | null | undefined): string {
  if (!value) return 'Other'
  return LEGACY_LEAD_SOURCE_LABELS[value] ?? value
}

// Fixed chip palette; a source's color is hashed from its label so any new
// source gets a stable color without a config entry.
const LEAD_SOURCE_TONES: string[] = [
  'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30',
  'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/30',
  'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
]

const LEAD_SOURCE_NEUTRAL =
  'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25'

export function leadSourceBadge(value: string | null | undefined): string {
  const label = leadSourceLabel(value)
  if (label === 'Other') return LEAD_SOURCE_NEUTRAL
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  return LEAD_SOURCE_TONES[hash % LEAD_SOURCE_TONES.length]
}

/**
 * Canonicalize a typed source against the vocabulary in use: a
 * case-insensitive match reuses the existing casing (so "trade show" and
 * "Trade Show" stay one filter entry); otherwise the text is kept as typed.
 */
export function canonicalLeadSource(raw: string | null | undefined, inUse: string[]): string {
  const typed = (raw ?? '').trim()
  if (!typed) return 'Other'
  const legacy = LEGACY_LEAD_SOURCE_LABELS[typed.toLowerCase()]
  if (legacy) return legacy
  const lower = typed.toLowerCase()
  const canonical = [...inUse, ...DEFAULT_LEAD_SOURCES].find((s) => s.toLowerCase() === lower)
  return canonical ?? typed
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const sqftFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export function formatSqft(value: number | null | undefined): string {
  if (value == null || value === 0) return '—'
  return `${sqftFormat.format(value)} SF`
}

// ─── Commissionable services ─────────────────────────────────────────────────
//
// A deal is built from a fixed set of commissionable services. Each has a
// price (charged) and cost (our cost / pass-through payout); margin = price −
// cost, and the salesperson earns commission_pct of that margin.

export type SteelServiceType = 'materials' | 'engineering' | 'assembly'

export const STEEL_SERVICE_TYPES: SteelServiceType[] = ['materials', 'engineering', 'assembly']

export const STEEL_SERVICE_LABELS: Record<SteelServiceType, string> = {
  materials: 'Steel / Materials',
  engineering: 'Engineering',
  assembly: 'Frame Assembly',
}

/** Order the three fixed sections render / sort in. */
export const STEEL_SERVICE_ORDER: Record<SteelServiceType, number> = {
  materials: 0,
  engineering: 1,
  assembly: 2,
}

export function isSteelServiceType(value: unknown): value is SteelServiceType {
  return typeof value === 'string' && (STEEL_SERVICE_TYPES as string[]).includes(value)
}

/** Default salesperson commission rate (% of margin) pre-filled on new lines. */
export const DEFAULT_SERVICE_COMMISSION_PCT = 10

/**
 * Services whose cost is driven by a per-square-foot basis (cost =
 * square_feet × cost_per_sqft). Engineering is excluded — its cost is a
 * manual dollar figure entered per deal.
 */
export const PER_SQFT_COST_SERVICES: SteelServiceType[] = ['materials', 'assembly']

export function isPerSqftCostService(type: SteelServiceType): boolean {
  return PER_SQFT_COST_SERVICES.includes(type)
}

/** Default steel/materials cost basis ($/SF), pre-filled on new deals. */
export const DEFAULT_STEEL_COST_PER_SQFT = 20

// ─── Pricing floor (management approval) ─────────────────────────────────────
//
// Steel priced below this $/SF needs management sign-off. The deal form warns
// on entry, and the save flow flags the deal (steel_deals.pricing_below_floor)
// so executives can spot below-floor pricing on the list/detail with a badge.

/** Steel pricing floor ($/SF). Below this, a deal needs management approval. */
export const STEEL_PRICE_FLOOR_PER_SQFT = 30

/**
 * Effective steel price per SF for the floor check: the steel/materials price
 * divided by square feet (covers both entry modes — a directly-typed materials
 * price and one auto-filled from SF × $/SF). Falls back to the entered Price/SF
 * when materials price or square feet is missing. Returns null when there's
 * nothing to judge.
 */
export function effectiveSteelPricePerSqft(
  materialsPrice: number | null | undefined,
  squareFeet: number | null | undefined,
  pricePerSqft: number | null | undefined
): number | null {
  const sf = numOr0(squareFeet)
  const mp = numOr0(materialsPrice)
  if (sf > 0 && mp > 0) return mp / sf
  const ppsf = numOr0(pricePerSqft)
  return ppsf > 0 ? ppsf : null
}

/** Whether a deal's effective steel $/SF is below the approval floor. */
export function isPricingBelowFloor(
  materialsPrice: number | null | undefined,
  squareFeet: number | null | undefined,
  pricePerSqft: number | null | undefined
): boolean {
  const eff = effectiveSteelPricePerSqft(materialsPrice, squareFeet, pricePerSqft)
  return eff != null && eff < STEEL_PRICE_FLOOR_PER_SQFT
}

const numOr0 = (v: number | null | undefined): number =>
  typeof v === 'number' && isFinite(v) ? v : 0

// ─── Referral fee (paid to the lead-source referrer) ─────────────────────────

export type ReferralFeeType = 'none' | 'flat' | 'percent'

export const REFERRAL_FEE_TYPES: ReferralFeeType[] = ['none', 'flat', 'percent']

export const REFERRAL_FEE_LABELS: Record<ReferralFeeType, string> = {
  none: 'No referral fee',
  flat: 'Flat fee',
  percent: '% of margin',
}

export function referralFeeType(value: string | null | undefined): ReferralFeeType {
  return REFERRAL_FEE_TYPES.includes(value as ReferralFeeType) ? (value as ReferralFeeType) : 'none'
}

// ─── Commission math ─────────────────────────────────────────────────────────

const n = (v: number | null | undefined): number => (typeof v === 'number' && isFinite(v) ? v : 0)

export interface ServiceLine {
  service_type: string
  price: number | null
  cost: number | null
  commission_pct: number | null
  commission_paid?: boolean | null
}

export function serviceMargin(s: Pick<ServiceLine, 'price' | 'cost'>): number {
  return n(s.price) - n(s.cost)
}

export function serviceCommission(s: Pick<ServiceLine, 'price' | 'cost' | 'commission_pct'>): number {
  return (serviceMargin(s) * n(s.commission_pct)) / 100
}

export function referralFeeAmount(
  type: string | null | undefined,
  value: number | null | undefined,
  totalMargin: number
): number {
  const t = referralFeeType(type)
  if (t === 'flat') return n(value)
  if (t === 'percent') return (totalMargin * n(value)) / 100
  return 0
}

export interface DealFinancials {
  revenue: number
  cost: number
  margin: number
  salespersonCommission: number
  referralFee: number
  /** Margin left after both commissions. */
  net: number
}

export function dealFinancials(
  services: ServiceLine[],
  referral_fee_type: string | null | undefined,
  referral_fee_value: number | null | undefined
): DealFinancials {
  const revenue = services.reduce((a, s) => a + n(s.price), 0)
  const cost = services.reduce((a, s) => a + n(s.cost), 0)
  const margin = revenue - cost
  const salespersonCommission = services.reduce((a, s) => a + serviceCommission(s), 0)
  const referralFee = referralFeeAmount(referral_fee_type, referral_fee_value, margin)
  return {
    revenue,
    cost,
    margin,
    salespersonCommission,
    referralFee,
    net: margin - salespersonCommission - referralFee,
  }
}

/** Contract value = sum of service prices (the deal's revenue). */
export function servicesRevenue(services: ServiceLine[]): number {
  return services.reduce((a, s) => a + n(s.price), 0)
}
