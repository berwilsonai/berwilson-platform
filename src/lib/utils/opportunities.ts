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

// ─── Opportunity Stage (THE SHARED DEAL PIPELINE) ───────────────────────────

/*
  ⚠ THIS BLOCK NO LONGER DEFINES A VOCABULARY — IT POINTS AT THE SHARED ONE
  (Richard, 2026-10-30: one vocabulary for both boards).

  Until now `opportunities.status` carried its own nine-member pipeline —
  identified / evaluating / in_discussion / due_diligence / negotiating /
  agreement / on_hold / closed_won / closed_passed — defined here as text with
  no Postgres enum behind it, while `projects.stage` carried a seven-member
  Postgres enum defined in `constants.ts`. Two tables, two languages, two sets
  of labels, two badge maps and two orderings for what every reader on every
  board thinks of as one question: how far along is this deal.

  The cost was not cosmetic. A promotion from an opportunity to a project had
  to translate between them, no surface could show both pipelines side by side,
  and `in_discussion` (singular) versus the project side's absence of any such
  member meant the two could never be compared even by eye.

  Opportunities now carry a `stage` column on the same `deal_stage` enum, and
  `status` is reduced to the parking flag projects always had. So the only
  honest content of this section is a re-export, kept so the dozen call sites
  under `components/opportunities/` read naturally — NOT a second definition.

  ⚠ DO NOT ADD A MEMBER HERE. The vocabulary lives in `constants.ts` and is
  typed `Record<DealStage, …>`, which is what makes the build name every map a
  new stage is missing from (§12 — the fix that ends the drift is the TYPE, not
  the derivation). A member added here would render nowhere else.
*/

export {
  STAGES as OPPORTUNITY_STAGES,
  STAGE_PIPELINE as OPPORTUNITY_PIPELINE,
  STAGE_CLOSED,
  STAGE_LABELS as OPPORTUNITY_STAGE_LABELS,
  STAGE_INDEX as OPPORTUNITY_STAGE_INDEX,
  STAGE_BADGE as OPPORTUNITY_STAGE_BADGE,
  isDealStage,
} from './constants'

import { STAGES, STAGE_CLOSED } from './constants'
import type { DealStage } from '@/lib/supabase/types'

/**
 * Narrow a value off the wire to a stage.
 *
 * Falls back to the entry stage rather than throwing, as `oppStage` did — a
 * board must still render a row whose column holds something unexpected. The
 * fallback is `prospecting` because that is the honest reading of "we do not
 * know where this is": the least committed position, never a flattering one.
 */
export function oppStage(value: string | null | undefined): DealStage {
  return STAGES.includes(value as DealStage) ? (value as DealStage) : 'prospecting'
}

/** Is this deal decided, either way? */
export function isClosedStage(value: string | null | undefined): boolean {
  return (STAGE_CLOSED as string[]).includes(value ?? '')
}

// ─── Opportunity status (the parking flag) ──────────────────────────────────

/**
 * ⚠ TWO MEMBERS, AND IT IS NOT THE PIPELINE ANY MORE. `opportunities.status`
 * held the nine-stage pipeline until 10-30 and now holds exactly what
 * `projects.status` holds: is this being worked, or parked? Guarded by
 * `opportunities_status_check` in the database, so a third value is refused at
 * the write rather than rendering blank.
 */
export const OPPORTUNITY_ACTIVITY = ['active', 'on_hold'] as const
export type OpportunityActivity = (typeof OPPORTUNITY_ACTIVITY)[number]

export const OPPORTUNITY_ACTIVITY_LABELS: Record<OpportunityActivity, string> = {
  active: 'Active',
  on_hold: 'On Hold',
}

export const OPPORTUNITY_ACTIVITY_BADGE: Record<OpportunityActivity, string> = {
  active: chipTone('positive'),
  on_hold: chipTone('caution'),
}

export function oppActivity(value: string | null | undefined): OpportunityActivity {
  return value === 'on_hold' ? 'on_hold' : 'active'
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
