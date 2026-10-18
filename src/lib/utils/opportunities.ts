import { chipTone } from '@/lib/ui/tone'

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
  acquisition: chipTone('violet'),
  partnership: chipTone('info'),
  joint_venture: chipTone('positive'),
  investment: chipTone('caution'),
  merger: chipTone('indigo'),
  divestiture: chipTone('rose'),
  teaming: chipTone('cyan'),
  market_entry: chipTone('orange'),
  other: chipTone('neutral'),
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
  other: 'border-l-border',
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
  | 'on_hold'
  | 'closed_won'
  | 'closed_passed'

export const OPPORTUNITY_STATUSES: OpportunityStatus[] = [
  'identified', 'evaluating', 'in_discussion', 'due_diligence',
  'negotiating', 'agreement', 'on_hold', 'closed_won', 'closed_passed',
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
  on_hold: 'On Hold',
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
  on_hold: -1, // parked — not on the active pipeline bar
  closed_won: 6,
  closed_passed: 6,
}

export const OPPORTUNITY_STATUS_BADGE: Record<OpportunityStatus, string> = {
  identified: chipTone('neutral'),
  evaluating: chipTone('info'),
  in_discussion: chipTone('cyan'),
  due_diligence: chipTone('caution'),
  negotiating: chipTone('violet'),
  agreement: chipTone('indigo'),
  on_hold: chipTone('caution'),
  closed_won: chipTone('positive'),
  closed_passed: chipTone('critical'),
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
  low: chipTone('neutral'),
  medium: chipTone('info'),
  high: chipTone('critical'),
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
