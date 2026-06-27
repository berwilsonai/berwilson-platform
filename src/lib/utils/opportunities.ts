/**
 * Constants for the Opportunities module — types, statuses, priorities, and their
 * labels/badge styles. Stored as text in the DB (no Postgres enums), so this file
 * is the source of truth for the allowed values and how they render.
 */

// ─── Opportunity Type ────────────────────────────────────────────────────────

export type OpportunityType =
  | 'acquisition'
  | 'partnership'
  | 'joint_venture'
  | 'investment'
  | 'merger'
  | 'divestiture'
  | 'teaming'
  | 'market_entry'
  | 'other'

export const OPPORTUNITY_TYPES: OpportunityType[] = [
  'acquisition', 'partnership', 'joint_venture', 'investment',
  'merger', 'divestiture', 'teaming', 'market_entry', 'other',
]

export const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, string> = {
  acquisition: 'Acquisition',
  partnership: 'Partnership',
  joint_venture: 'Joint Venture',
  investment: 'Investment',
  merger: 'Merger',
  divestiture: 'Divestiture',
  teaming: 'Teaming Agreement',
  market_entry: 'Market Entry',
  other: 'Other',
}

export const OPPORTUNITY_TYPE_BADGE: Record<OpportunityType, string> = {
  acquisition: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  partnership: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  joint_venture: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  investment: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  merger: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
  divestiture: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
  teaming: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30',
  market_entry: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30',
  other: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
}

export const OPPORTUNITY_TYPE_BORDER: Record<OpportunityType, string> = {
  acquisition: 'border-l-violet-400',
  partnership: 'border-l-blue-400',
  joint_venture: 'border-l-emerald-400',
  investment: 'border-l-amber-400',
  merger: 'border-l-indigo-400',
  divestiture: 'border-l-rose-400',
  teaming: 'border-l-cyan-400',
  market_entry: 'border-l-orange-400',
  other: 'border-l-slate-300',
}

export function oppType(value: string | null | undefined): OpportunityType {
  return OPPORTUNITY_TYPES.includes(value as OpportunityType)
    ? (value as OpportunityType)
    : 'other'
}

// ─── Opportunity Status (deal pipeline) ──────────────────────────────────────

export type OpportunityStatus =
  | 'identified'
  | 'evaluating'
  | 'in_discussion'
  | 'due_diligence'
  | 'negotiating'
  | 'agreement'
  | 'closed_won'
  | 'closed_passed'

export const OPPORTUNITY_STATUSES: OpportunityStatus[] = [
  'identified', 'evaluating', 'in_discussion', 'due_diligence',
  'negotiating', 'agreement', 'closed_won', 'closed_passed',
]

/** Active pipeline stages, in order (excludes the two closed states). */
export const OPPORTUNITY_PIPELINE: OpportunityStatus[] = [
  'identified', 'evaluating', 'in_discussion', 'due_diligence', 'negotiating', 'agreement',
]

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  identified: 'Identified',
  evaluating: 'Evaluating',
  in_discussion: 'In Discussion',
  due_diligence: 'Due Diligence',
  negotiating: 'Negotiating',
  agreement: 'Agreement',
  closed_won: 'Closed — Pursued',
  closed_passed: 'Closed — Passed',
}

export const OPPORTUNITY_STATUS_INDEX: Record<OpportunityStatus, number> = {
  identified: 0,
  evaluating: 1,
  in_discussion: 2,
  due_diligence: 3,
  negotiating: 4,
  agreement: 5,
  closed_won: 6,
  closed_passed: 6,
}

export const OPPORTUNITY_STATUS_BADGE: Record<OpportunityStatus, string> = {
  identified: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
  evaluating: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  in_discussion: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30',
  due_diligence: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  negotiating: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  agreement: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
  closed_won: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  closed_passed: 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
}

export function oppStatus(value: string | null | undefined): OpportunityStatus {
  return OPPORTUNITY_STATUSES.includes(value as OpportunityStatus)
    ? (value as OpportunityStatus)
    : 'identified'
}

export function isClosedStatus(value: string | null | undefined): boolean {
  return value === 'closed_won' || value === 'closed_passed'
}

// ─── Priority ────────────────────────────────────────────────────────────────

export type OpportunityPriority = 'low' | 'medium' | 'high'

export const OPPORTUNITY_PRIORITIES: OpportunityPriority[] = ['low', 'medium', 'high']

export const OPPORTUNITY_PRIORITY_LABELS: Record<OpportunityPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export const OPPORTUNITY_PRIORITY_BADGE: Record<OpportunityPriority, string> = {
  low: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
  medium: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  high: 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
}

export function oppPriority(value: string | null | undefined): OpportunityPriority {
  return value === 'low' || value === 'high' ? value : 'medium'
}

// ─── Document types ──────────────────────────────────────────────────────────

export const OPPORTUNITY_DOC_TYPES = [
  'white_paper', 'teaser', 'cim', 'financials', 'deck', 'memo', 'other',
] as const

export const OPPORTUNITY_DOC_TYPE_LABELS: Record<string, string> = {
  white_paper: 'White Paper',
  teaser: 'Teaser',
  cim: 'CIM',
  financials: 'Financials',
  deck: 'Deck',
  memo: 'Memo',
  other: 'Other',
}
