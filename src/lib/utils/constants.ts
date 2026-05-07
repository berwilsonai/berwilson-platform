/**
 * Centralized constants for the platform.
 * All enum values, labels, badge styles, and display mappings live here.
 * Import from this file instead of scattering magic strings across components.
 */

import type {
  ProjectSector,
  ProjectStatus,
  ProjectStage,
  DdSeverity,
  EntityType,
  ComplianceStatus,
} from '@/lib/supabase/types'

// ─── Sectors ─────────────────────────────────────────────────────────────────

export const SECTORS: ProjectSector[] = [
  'government', 'infrastructure', 'real_estate', 'prefab', 'institutional',
]

export const SECTOR_LABELS: Record<ProjectSector, string> = {
  government: 'Government',
  infrastructure: 'Infrastructure',
  real_estate: 'Real Estate',
  prefab: 'Prefab',
  institutional: 'Institutional',
}

export const SECTOR_SHORT: Record<ProjectSector, string> = {
  government: "Gov't",
  infrastructure: 'Infra',
  real_estate: 'Real Estate',
  prefab: 'Prefab',
  institutional: 'Institutional',
}

export const SECTOR_BADGE: Record<ProjectSector, string> = {
  government: 'bg-blue-50 text-blue-700 ring-blue-200',
  infrastructure: 'bg-amber-50 text-amber-700 ring-amber-200',
  real_estate: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  prefab: 'bg-violet-50 text-violet-700 ring-violet-200',
  institutional: 'bg-slate-100 text-slate-600 ring-slate-200',
}

// ─── Statuses ────────────────────────────────────────────────────────────────

export const STATUSES: ProjectStatus[] = [
  'active', 'on_hold', 'won', 'lost', 'closed',
]

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  won: 'Won',
  lost: 'Lost',
  closed: 'Closed',
}

export const STATUS_BADGE: Record<ProjectStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  on_hold: 'bg-amber-50 text-amber-700 ring-amber-200',
  won: 'bg-blue-50 text-blue-700 ring-blue-200',
  lost: 'bg-red-50 text-red-600 ring-red-200',
  closed: 'bg-slate-100 text-slate-600 ring-slate-200',
}

// ─── Stages ──────────────────────────────────────────────────────────────────

export const STAGES: ProjectStage[] = [
  'pursuit', 'capture', 'bid', 'award', 'mobilization', 'execution', 'closeout',
]

export const STAGE_LABELS: Record<ProjectStage, string> = {
  pursuit: 'Pursuit',
  capture: 'Capture',
  bid: 'Bid',
  award: 'Award',
  mobilization: 'Mobilization',
  execution: 'Execution',
  closeout: 'Closeout',
}

export const STAGE_INDEX: Record<ProjectStage, number> = {
  pursuit: 0,
  capture: 1,
  bid: 2,
  award: 3,
  mobilization: 4,
  execution: 5,
  closeout: 6,
}

// ─── DD Severity ─────────────────────────────────────────────────────────────

export const SEVERITIES: DdSeverity[] = ['info', 'watch', 'critical', 'blocker']

export const SEVERITY_LABELS: Record<DdSeverity, string> = {
  info: 'Info',
  watch: 'Watch',
  critical: 'Critical',
  blocker: 'Blocker',
}

export const SEVERITY_BADGE: Record<DdSeverity, string> = {
  info: 'bg-slate-50 text-slate-600 ring-slate-200',
  watch: 'bg-amber-50 text-amber-700 ring-amber-200',
  critical: 'bg-orange-50 text-orange-700 ring-orange-200',
  blocker: 'bg-red-100 text-red-700 ring-red-200',
}

// ─── Entity Types ────────────────────────────────────────────────────────────

export const ENTITY_TYPES: EntityType[] = [
  'llc', 'corp', 'jv', 'subsidiary', 'trust', 'fund', 'other',
]

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  llc: 'LLC',
  corp: 'Corp',
  jv: 'JV',
  subsidiary: 'Subsidiary',
  trust: 'Trust',
  fund: 'Fund',
  other: 'Other',
}

export const ENTITY_TYPE_BADGE: Record<EntityType, string> = {
  llc: 'bg-blue-50 text-blue-700 ring-blue-200',
  corp: 'bg-violet-50 text-violet-700 ring-violet-200',
  jv: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  subsidiary: 'bg-amber-50 text-amber-700 ring-amber-200',
  trust: 'bg-rose-50 text-rose-700 ring-rose-200',
  fund: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  other: 'bg-slate-50 text-slate-600 ring-slate-200',
}

// ─── Compliance Status ───────────────────────────────────────────────────────

export const COMPLIANCE_STATUSES: ComplianceStatus[] = [
  'not_started', 'in_progress', 'compliant', 'non_compliant', 'waived',
]

export const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  compliant: 'Compliant',
  non_compliant: 'Non-Compliant',
  waived: 'Waived',
}

// ─── Activity Log ────────────────────────────────────────────────────────────

export const ACTIVITY_TABLE_LABELS: Record<string, string> = {
  projects: 'Projects',
  updates: 'Updates',
  documents: 'Documents',
  milestones: 'Milestones',
  dd_items: 'Diligence',
  financing_structures: 'Financing',
  compliance_items: 'Compliance',
  review_queue: 'Review Queue',
  parties: 'Parties',
  project_players: 'Team',
}

export const ACTIVITY_ACTION_STYLES: Record<string, string> = {
  INSERT: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  UPDATE: 'bg-blue-50 text-blue-700 ring-blue-200',
  DELETE: 'bg-red-50 text-red-600 ring-red-200',
}

// ─── Entity Relationships ────────────────────────────────────────────────────

export const RELATIONSHIP_LABELS: Record<string, string> = {
  owner: 'Owner',
  jv_partner: 'JV Partner',
  sub_entity: 'Sub-Entity',
  guarantor: 'Guarantor',
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function formatValue(value: number | null): string {
  if (value === null || value === undefined) return '—'
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
