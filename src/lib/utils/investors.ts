/**
 * Constants for the Investors module — investor types, relationship pipeline
 * stages, interest levels, investment (commitment) stages, instruments, and
 * their labels/badge styles. Stored as text in the DB (no Postgres enums), so
 * this file is the source of truth for the allowed values and how they render.
 */

// ─── Investor Type ───────────────────────────────────────────────────────────

export type InvestorType =
  | 'individual'
  | 'family_office'
  | 'private_equity'
  | 'venture_capital'
  | 'institutional'
  | 'bank_lender'
  | 'tribal'
  | 'strategic'
  | 'other'

export const INVESTOR_TYPES: InvestorType[] = [
  'individual', 'family_office', 'private_equity', 'venture_capital',
  'institutional', 'bank_lender', 'tribal', 'strategic', 'other',
]

export const INVESTOR_TYPE_LABELS: Record<InvestorType, string> = {
  individual: 'Individual',
  family_office: 'Family Office',
  private_equity: 'Private Equity',
  venture_capital: 'Venture Capital',
  institutional: 'Institutional',
  bank_lender: 'Bank / Lender',
  tribal: 'Tribal',
  strategic: 'Strategic',
  other: 'Other',
}

export const INVESTOR_TYPE_BADGE: Record<InvestorType, string> = {
  individual: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  family_office: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  private_equity: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
  venture_capital: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30',
  institutional: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  bank_lender: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
  tribal: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  strategic: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30',
  other: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
}

export const INVESTOR_TYPE_BORDER: Record<InvestorType, string> = {
  individual: 'border-l-blue-400',
  family_office: 'border-l-violet-400',
  private_equity: 'border-l-indigo-400',
  venture_capital: 'border-l-cyan-400',
  institutional: 'border-l-emerald-400',
  bank_lender: 'border-l-slate-300',
  tribal: 'border-l-amber-400',
  strategic: 'border-l-orange-400',
  other: 'border-l-slate-300',
}

export function investorType(value: string | null | undefined): InvestorType {
  return INVESTOR_TYPES.includes(value as InvestorType)
    ? (value as InvestorType)
    : 'other'
}

// ─── Investor Stage (relationship pipeline) ──────────────────────────────────

export type InvestorStage =
  | 'identified'
  | 'contacted'
  | 'in_conversation'
  | 'materials_sent'
  | 'diligence'
  | 'soft_committed'
  | 'committed'
  | 'funded'
  | 'passed'
  | 'dormant'

export const INVESTOR_STAGES: InvestorStage[] = [
  'identified', 'contacted', 'in_conversation', 'materials_sent',
  'diligence', 'soft_committed', 'committed', 'funded', 'passed', 'dormant',
]

/** Active pipeline stages, in order (excludes the two off-ramp states). */
export const INVESTOR_PIPELINE: InvestorStage[] = [
  'identified', 'contacted', 'in_conversation', 'materials_sent',
  'diligence', 'soft_committed', 'committed', 'funded',
]

export const INVESTOR_STAGE_LABELS: Record<InvestorStage, string> = {
  identified: 'Identified',
  contacted: 'Contacted',
  in_conversation: 'In Conversation',
  materials_sent: 'Materials Sent',
  diligence: 'Diligence',
  soft_committed: 'Soft Committed',
  committed: 'Committed',
  funded: 'Funded',
  passed: 'Passed',
  dormant: 'Dormant',
}

export const INVESTOR_STAGE_INDEX: Record<InvestorStage, number> = {
  identified: 0,
  contacted: 1,
  in_conversation: 2,
  materials_sent: 3,
  diligence: 4,
  soft_committed: 5,
  committed: 6,
  funded: 7,
  passed: -1,
  dormant: -1,
}

export const INVESTOR_STAGE_BADGE: Record<InvestorStage, string> = {
  identified: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
  contacted: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  in_conversation: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30',
  materials_sent: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  diligence: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  soft_committed: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  committed: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
  funded: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  passed: 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  dormant: 'bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-400 dark:ring-slate-400/25',
}

export function investorStage(value: string | null | undefined): InvestorStage {
  return INVESTOR_STAGES.includes(value as InvestorStage)
    ? (value as InvestorStage)
    : 'identified'
}

export function isOffPipeline(value: string | null | undefined): boolean {
  return value === 'passed' || value === 'dormant'
}

// ─── Interest Level ──────────────────────────────────────────────────────────

export type InterestLevel = 'hot' | 'warm' | 'cool' | 'cold'

export const INTEREST_LEVELS: InterestLevel[] = ['hot', 'warm', 'cool', 'cold']

export const INTEREST_LEVEL_LABELS: Record<InterestLevel, string> = {
  hot: 'Hot',
  warm: 'Warm',
  cool: 'Cool',
  cold: 'Cold',
}

export const INTEREST_LEVEL_BADGE: Record<InterestLevel, string> = {
  hot: 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  warm: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  cool: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  cold: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
}

export function interestLevel(value: string | null | undefined): InterestLevel {
  return INTEREST_LEVELS.includes(value as InterestLevel)
    ? (value as InterestLevel)
    : 'warm'
}

// ─── Investment Stage (per-commitment) ───────────────────────────────────────

export type InvestmentStage =
  | 'discussing'
  | 'soft_circled'
  | 'term_sheet'
  | 'committed'
  | 'docs'
  | 'funded'
  | 'passed'

export const INVESTMENT_STAGES: InvestmentStage[] = [
  'discussing', 'soft_circled', 'term_sheet', 'committed', 'docs', 'funded', 'passed',
]

export const INVESTMENT_STAGE_LABELS: Record<InvestmentStage, string> = {
  discussing: 'Discussing',
  soft_circled: 'Soft-Circled',
  term_sheet: 'Term Sheet',
  committed: 'Committed',
  docs: 'In Docs',
  funded: 'Funded',
  passed: 'Passed',
}

export const INVESTMENT_STAGE_BADGE: Record<InvestmentStage, string> = {
  discussing: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
  soft_circled: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  term_sheet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  committed: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
  docs: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30',
  funded: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  passed: 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
}

export function investmentStage(value: string | null | undefined): InvestmentStage {
  return INVESTMENT_STAGES.includes(value as InvestmentStage)
    ? (value as InvestmentStage)
    : 'discussing'
}

// ─── Instrument (also the vocab for investors.preferred_structures) ──────────

export type Instrument =
  | 'common_equity'
  | 'preferred_equity'
  | 'convertible_note'
  | 'debt'
  | 'mezzanine'
  | 'profit_share'
  | 'revenue_share'
  | 'other'

export const INSTRUMENTS: Instrument[] = [
  'common_equity', 'preferred_equity', 'convertible_note', 'debt',
  'mezzanine', 'profit_share', 'revenue_share', 'other',
]

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  common_equity: 'Common Equity',
  preferred_equity: 'Preferred Equity',
  convertible_note: 'Convertible Note',
  debt: 'Debt',
  mezzanine: 'Mezzanine',
  profit_share: 'Profit Share',
  revenue_share: 'Revenue Share',
  other: 'Other',
}

export function instrumentLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return INSTRUMENT_LABELS[value as Instrument] ?? value
}

// ─── Target kind ─────────────────────────────────────────────────────────────

export type TargetKind = 'company' | 'project'

export const TARGET_KIND_LABELS: Record<TargetKind, string> = {
  company: 'Ber Wilson (parent)',
  project: 'Project / SPV',
}
