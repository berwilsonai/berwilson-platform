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
  | 'paid'
  | 'lost'

export const STEEL_STAGES: SteelStage[] = [
  'quote', 'engineering', 'order_placed', 'delivered', 'paid', 'lost',
]

/** Active pipeline stages, in order (excludes the off-ramp state). */
export const STEEL_PIPELINE: SteelStage[] = [
  'quote', 'engineering', 'order_placed', 'delivered', 'paid',
]

export const STEEL_STAGE_LABELS: Record<SteelStage, string> = {
  quote: 'Quote',
  engineering: 'Engineering',
  order_placed: 'Order Placed',
  delivered: 'Delivered',
  paid: 'Paid',
  lost: 'Lost',
}

export const STEEL_STAGE_INDEX: Record<SteelStage, number> = {
  quote: 0,
  engineering: 1,
  order_placed: 2,
  delivered: 3,
  paid: 4,
  lost: -1,
}

export const STEEL_STAGE_BADGE: Record<SteelStage, string> = {
  quote: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  engineering: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  order_placed: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
  delivered: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30',
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  lost: 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
}

export const STEEL_STAGE_BORDER: Record<SteelStage, string> = {
  quote: 'border-l-blue-400',
  engineering: 'border-l-violet-400',
  order_placed: 'border-l-indigo-400',
  delivered: 'border-l-cyan-400',
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
