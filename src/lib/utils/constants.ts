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
  BwRole,
  SiteStatus,
  ComponentType,
  ComponentStatus,
  StakeholderTemperature,
  FundingCategory,
  FundingStatusEnum,
  EngagementState,
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

export const STAGE_BADGE: Record<ProjectStage, string> = {
  pursuit: 'bg-slate-100 text-slate-600 ring-slate-200',
  capture: 'bg-violet-50 text-violet-700 ring-violet-200',
  bid: 'bg-amber-50 text-amber-700 ring-amber-200',
  award: 'bg-blue-50 text-blue-700 ring-blue-200',
  mobilization: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  execution: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  closeout: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
}

export const STAGE_COLOR: Record<ProjectStage, string> = {
  pursuit: 'bg-slate-400',
  capture: 'bg-violet-500',
  bid: 'bg-amber-500',
  award: 'bg-blue-500',
  mobilization: 'bg-cyan-500',
  execution: 'bg-emerald-500',
  closeout: 'bg-indigo-500',
}

export const STAGE_BORDER: Record<ProjectStage, string> = {
  pursuit: 'border-l-slate-300 [--card-glow-color:oklch(0.60_0_0)]',
  capture: 'border-l-violet-400 [--card-glow-color:oklch(0.55_0.18_290)]',
  bid: 'border-l-amber-400 [--card-glow-color:oklch(0.70_0.12_85)]',
  award: 'border-l-blue-400 [--card-glow-color:oklch(0.55_0.15_260)]',
  mobilization: 'border-l-cyan-400 [--card-glow-color:oklch(0.60_0.12_200)]',
  execution: 'border-l-emerald-400 [--card-glow-color:oklch(0.55_0.15_145)]',
  closeout: 'border-l-indigo-400 [--card-glow-color:oklch(0.50_0.15_275)]',
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

// ─── Portfolio: Ber Wilson Roles ────────────────────────────────────────────

export const BW_ROLES: BwRole[] = [
  'master_developer_gc', 'developer_only', 'gc_only', 'cm_under_sna', 'program_architect', 'joint_venture',
]

export const BW_ROLE_LABELS: Record<BwRole, string> = {
  master_developer_gc: 'Master Developer + GC',
  developer_only: 'Developer Only',
  gc_only: 'GC Only',
  cm_under_sna: 'CM under SNA Contracting',
  program_architect: 'Program Architect / Advisor',
  joint_venture: 'Joint Venture',
}

export const BW_ROLE_BADGE: Record<BwRole, string> = {
  master_developer_gc: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  developer_only: 'bg-blue-50 text-blue-700 ring-blue-200',
  gc_only: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  cm_under_sna: 'bg-amber-50 text-amber-700 ring-amber-200',
  program_architect: 'bg-violet-50 text-violet-700 ring-violet-200',
  joint_venture: 'bg-rose-50 text-rose-700 ring-rose-200',
}

// ─── Portfolio: Site Status ─────────────────────────────────────────────────

export const SITE_STATUSES: SiteStatus[] = ['lead_site', 'active', 'planning', 'evaluation']

export const SITE_STATUS_LABELS: Record<SiteStatus, string> = {
  active: 'Active',
  planning: 'Planning',
  evaluation: 'Evaluation',
  lead_site: 'Lead Site',
}

export const SITE_STATUS_BADGE: Record<SiteStatus, string> = {
  lead_site: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  planning: 'bg-amber-50 text-amber-700 ring-amber-200',
  evaluation: 'bg-slate-100 text-slate-600 ring-slate-200',
}

// ─── Portfolio: Component Types ─────────────────────────────────────────────

export const COMPONENT_TYPES: ComponentType[] = [
  'quantum_data_center', 'power_nexus', 'hospital', 'workforce_housing',
  'light_rail', 'freight_rail', 'civic_center', 'police_station',
  'fire_station', 'airport', 'public_safety_complex', 'urban_forestry',
  'cooling_infrastructure', 'other',
]

export const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
  quantum_data_center: 'Quantum Data Center',
  power_nexus: 'Power Nexus',
  hospital: 'Hospital',
  workforce_housing: 'Workforce Housing',
  light_rail: 'Light Rail',
  freight_rail: 'Freight Rail (STRACNET)',
  civic_center: 'Civic Center',
  police_station: 'Police Station',
  fire_station: 'Fire Station',
  airport: 'Airport',
  public_safety_complex: 'Public Safety Complex',
  urban_forestry: 'Urban Forestry',
  cooling_infrastructure: 'Cooling Infrastructure',
  other: 'Other',
}

export const COMPONENT_TYPE_BADGE: Record<ComponentType, string> = {
  quantum_data_center: 'bg-violet-50 text-violet-700 ring-violet-200',
  power_nexus: 'bg-amber-50 text-amber-700 ring-amber-200',
  hospital: 'bg-rose-50 text-rose-700 ring-rose-200',
  workforce_housing: 'bg-blue-50 text-blue-700 ring-blue-200',
  light_rail: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  freight_rail: 'bg-orange-50 text-orange-700 ring-orange-200',
  civic_center: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  police_station: 'bg-slate-100 text-slate-600 ring-slate-200',
  fire_station: 'bg-red-50 text-red-600 ring-red-200',
  airport: 'bg-sky-50 text-sky-700 ring-sky-200',
  public_safety_complex: 'bg-slate-100 text-slate-600 ring-slate-200',
  urban_forestry: 'bg-lime-50 text-lime-700 ring-lime-200',
  cooling_infrastructure: 'bg-teal-50 text-teal-700 ring-teal-200',
  other: 'bg-slate-50 text-slate-600 ring-slate-200',
}

// ─── Portfolio: Component Status ────────────────────────────────────────────

export const COMPONENT_STATUSES: ComponentStatus[] = [
  'conceptual', 'planning', 'pre_development', 'design',
  'procurement', 'construction', 'commissioning', 'operating',
]

export const COMPONENT_STATUS_LABELS: Record<ComponentStatus, string> = {
  conceptual: 'Conceptual',
  planning: 'Planning',
  pre_development: 'Pre-Development',
  design: 'Design',
  procurement: 'Procurement',
  construction: 'Construction',
  commissioning: 'Commissioning',
  operating: 'Operating',
}

export const COMPONENT_STATUS_BADGE: Record<ComponentStatus, string> = {
  conceptual: 'bg-slate-100 text-slate-600 ring-slate-200',
  planning: 'bg-amber-50 text-amber-700 ring-amber-200',
  pre_development: 'bg-orange-50 text-orange-700 ring-orange-200',
  design: 'bg-blue-50 text-blue-700 ring-blue-200',
  procurement: 'bg-violet-50 text-violet-700 ring-violet-200',
  construction: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  commissioning: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  operating: 'bg-green-50 text-green-700 ring-green-200',
}

// ─── Portfolio: Stakeholder Temperature ─────────────────────────────────────

export const TEMPERATURES: StakeholderTemperature[] = [
  'champion', 'supportive', 'neutral', 'concerned', 'opposed', 'unknown',
]

export const TEMPERATURE_LABELS: Record<StakeholderTemperature, string> = {
  champion: 'Champion',
  supportive: 'Supportive',
  neutral: 'Neutral',
  concerned: 'Concerned',
  opposed: 'Opposed',
  unknown: 'Unknown',
}

export const TEMPERATURE_BADGE: Record<StakeholderTemperature, string> = {
  champion: 'bg-green-50 text-green-700 ring-green-200',
  supportive: 'bg-blue-50 text-blue-700 ring-blue-200',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  concerned: 'bg-amber-50 text-amber-700 ring-amber-200',
  opposed: 'bg-red-50 text-red-600 ring-red-200',
  unknown: 'bg-slate-50 text-slate-500 ring-slate-200',
}

// ─── Portfolio: Funding Categories ──────────────────────────────────────────

export const FUNDING_CATEGORIES: FundingCategory[] = [
  'federal_grant', 'state_grant', 'local', 'private_equity', 'debt', 'ppa', 'tax_credit', 'revenue_share',
]

export const FUNDING_CATEGORY_LABELS: Record<FundingCategory, string> = {
  federal_grant: 'Federal Grant',
  state_grant: 'State Grant',
  local: 'Local',
  private_equity: 'Private Equity',
  debt: 'Debt',
  ppa: 'PPA',
  tax_credit: 'Tax Credit',
  revenue_share: 'Revenue Share',
}

export const FUNDING_CATEGORY_BADGE: Record<FundingCategory, string> = {
  federal_grant: 'bg-blue-50 text-blue-700 ring-blue-200',
  state_grant: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  local: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  private_equity: 'bg-violet-50 text-violet-700 ring-violet-200',
  debt: 'bg-amber-50 text-amber-700 ring-amber-200',
  ppa: 'bg-orange-50 text-orange-700 ring-orange-200',
  tax_credit: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  revenue_share: 'bg-rose-50 text-rose-700 ring-rose-200',
}

// ─── Portfolio: Funding Status ──────────────────────────────────────────────

export const FUNDING_STATUSES: FundingStatusEnum[] = [
  'target', 'outreach', 'application_submitted', 'awarded', 'closed', 'drawn',
]

export const FUNDING_STATUS_LABELS: Record<FundingStatusEnum, string> = {
  target: 'Target',
  outreach: 'Outreach',
  application_submitted: 'Application Submitted',
  awarded: 'Awarded',
  closed: 'Closed',
  drawn: 'Drawn',
}

// ─── Portfolio: Engagement State ────────────────────────────────────────────

export const ENGAGEMENT_STATES: EngagementState[] = [
  'solicited', 'bidding', 'awarded', 'mobilized', 'active', 'demobilized', 'complete',
]

export const ENGAGEMENT_STATE_LABELS: Record<EngagementState, string> = {
  solicited: 'Solicited',
  bidding: 'Bidding',
  awarded: 'Awarded',
  mobilized: 'Mobilized',
  active: 'Active',
  demobilized: 'Demobilized',
  complete: 'Complete',
}
