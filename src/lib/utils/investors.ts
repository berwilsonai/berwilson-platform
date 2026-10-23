import { chipTone } from '@/lib/ui/tone'

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
  | 'private_lender'
  | 'tribal'
  | 'strategic'
  | 'other'

export const INVESTOR_TYPES: InvestorType[] = [
  'individual', 'family_office', 'private_equity', 'venture_capital',
  'institutional', 'bank_lender', 'private_lender', 'tribal', 'strategic', 'other',
]

export const INVESTOR_TYPE_LABELS: Record<InvestorType, string> = {
  individual: 'Individual',
  family_office: 'Family Office',
  private_equity: 'Private Equity',
  venture_capital: 'Venture Capital',
  institutional: 'Institutional',
  bank_lender: 'Bank / Lender',
  private_lender: 'Private Lender / Debt Fund',
  tribal: 'Tribal',
  strategic: 'Strategic',
  other: 'Other',
}

export const INVESTOR_TYPE_BADGE: Record<InvestorType, string> = {
  individual: chipTone('info'),
  family_office: chipTone('violet'),
  private_equity: chipTone('indigo'),
  venture_capital: chipTone('cyan'),
  institutional: chipTone('positive'),
  bank_lender: chipTone('neutral'),
  private_lender: chipTone('teal'),
  tribal: chipTone('caution'),
  strategic: chipTone('orange'),
  other: chipTone('neutral'),
}

export const INVESTOR_TYPE_BORDER: Record<InvestorType, string> = {
  individual: 'border-l-blue-400',
  family_office: 'border-l-violet-400',
  private_equity: 'border-l-indigo-400',
  venture_capital: 'border-l-cyan-400',
  institutional: 'border-l-emerald-400',
  bank_lender: 'border-l-border',
  private_lender: 'border-l-teal-400',
  tribal: 'border-l-amber-400',
  strategic: 'border-l-orange-400',
  other: 'border-l-border',
}

export function investorType(value: string | null | undefined): InvestorType {
  return INVESTOR_TYPES.includes(value as InvestorType)
    ? (value as InvestorType)
    : 'other'
}

/** Lender-type investors are debt, not equity — they carry documentation
 *  requirement checklists and their terms live in terms_notes. */
export function isLenderType(value: string | null | undefined): boolean {
  return value === 'bank_lender' || value === 'private_lender'
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
  identified: chipTone('neutral'),
  contacted: chipTone('info'),
  in_conversation: chipTone('cyan'),
  materials_sent: chipTone('sky'),
  diligence: chipTone('caution'),
  soft_committed: chipTone('violet'),
  committed: chipTone('indigo'),
  funded: chipTone('positive'),
  passed: chipTone('critical'),
  dormant: chipTone('neutral'),
}

export function investorStage(value: string | null | undefined): InvestorStage {
  return INVESTOR_STAGES.includes(value as InvestorStage)
    ? (value as InvestorStage)
    : 'identified'
}

export function isOffPipeline(value: string | null | undefined): boolean {
  return value === 'passed' || value === 'dormant'
}

/** True when a YYYY-MM-DD date is before today (local). Shared by server pages
 *  and client components — must live outside any 'use client' module. */
export function isPastDate(dateStr: string | null): boolean {
  if (!dateStr) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(`${dateStr}T00:00:00`).getTime() < today.getTime()
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
  hot: chipTone('critical'),
  warm: chipTone('caution'),
  cool: chipTone('sky'),
  cold: chipTone('neutral'),
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
  discussing: chipTone('neutral'),
  soft_circled: chipTone('caution'),
  term_sheet: chipTone('violet'),
  committed: chipTone('indigo'),
  docs: chipTone('cyan'),
  funded: chipTone('positive'),
  passed: chipTone('critical'),
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
  project: 'Project',
}

// ─── Raise status ────────────────────────────────────────────────────────────

export type RaiseStatus = 'planned' | 'open' | 'closed'

export const RAISE_STATUSES: RaiseStatus[] = ['planned', 'open', 'closed']

export const RAISE_STATUS_LABELS: Record<RaiseStatus, string> = {
  planned: 'Planned',
  open: 'Open',
  closed: 'Closed',
}

export const RAISE_STATUS_BADGE: Record<RaiseStatus, string> = {
  planned: chipTone('neutral'),
  open: chipTone('positive'),
  closed: chipTone('indigo'),
}

export function raiseStatus(value: string | null | undefined): RaiseStatus {
  return RAISE_STATUSES.includes(value as RaiseStatus)
    ? (value as RaiseStatus)
    : 'open'
}

// ─── Requirement checklist (lender documentation) ────────────────────────────

export type RequirementCategory = 'corporate' | 'project' | 'sponsor' | 'other'

export const REQUIREMENT_CATEGORIES: RequirementCategory[] = [
  'corporate', 'project', 'sponsor', 'other',
]

export const REQUIREMENT_CATEGORY_LABELS: Record<RequirementCategory, string> = {
  corporate: 'Corporate',
  project: 'Project',
  sponsor: 'Sponsor',
  other: 'Other',
}

export type RequirementStatus =
  | 'needed'
  | 'in_progress'
  | 'have'
  | 'submitted'
  | 'waived'
  | 'n_a'

export const REQUIREMENT_STATUSES: RequirementStatus[] = [
  'needed', 'in_progress', 'have', 'submitted', 'waived', 'n_a',
]

export const REQUIREMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  needed: 'Needed',
  in_progress: 'In Progress',
  have: 'Have',
  submitted: 'Submitted',
  waived: 'Waived',
  n_a: 'N/A',
}

/** Statuses that still need action before a package is complete. */
export const REQUIREMENT_OPEN_STATUSES: RequirementStatus[] = ['needed', 'in_progress']

export function requirementCategory(value: string | null | undefined): RequirementCategory {
  return REQUIREMENT_CATEGORIES.includes(value as RequirementCategory)
    ? (value as RequirementCategory)
    : 'other'
}

export function requirementStatus(value: string | null | undefined): RequirementStatus {
  return REQUIREMENT_STATUSES.includes(value as RequirementStatus)
    ? (value as RequirementStatus)
    : 'needed'
}

// ─── Investment target ───────────────────────────────────────────────────────

/**
 * What a commitment is into.
 *
 * ⚠ THE SAME TWO MEMBERS AS `investments_target_check` AND
 * `INVESTMENT_TARGETS` IN src/lib/investors/parse.ts. A taxonomy written in two
 * places drifts silently, because a member one copy was never told about simply
 * never fires (§12) — which is exactly how `spv` would have been offered by the
 * form and then filtered out of every list. `spv` itself was removed
 * 2026-10-23 with the Vehicles module; the test below holds the three copies
 * to each other.
 */
export type InvestmentTargetKind = 'company' | 'project'

export const INVESTMENT_TARGET_KINDS: InvestmentTargetKind[] = ['company', 'project']

export const INVESTMENT_TARGET_LABELS: Record<InvestmentTargetKind, string> = {
  company: 'Ber Wilson (parent)',
  project: 'A project',
}

export function isInvestmentTargetKind(value: unknown): value is InvestmentTargetKind {
  return typeof value === 'string' && (INVESTMENT_TARGET_KINDS as string[]).includes(value)
}

/**
 * The name to print for one commitment's target.
 *
 * ⚠ ONE DEFINITION, BECAUSE THERE WERE FOUR. The investors list, the investor
 * detail page, `search_investors` and the investor embedding each wrote their
 * own `target_kind === 'company' ? … : project?.name ?? 'Project'`. A label
 * that is wrong in four places is a label with no owner, which is why this
 * stays shared even now the union is down to two members.
 *
 * ⚠ A MISSING NAME IS SAID IN WORDS, never left as a bare em dash or an empty
 * string at a value's own weight, which reads as a failed render (§12).
 */
export function investmentTargetLabel(input: {
  target_kind: string
  project?: { name: string } | null
}): string {
  if (input.target_kind === 'company') return INVESTMENT_TARGET_LABELS.company
  return input.project?.name ?? 'An unnamed project'
}
