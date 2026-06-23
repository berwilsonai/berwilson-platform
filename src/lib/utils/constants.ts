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
  government: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  infrastructure: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  real_estate: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  prefab: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  institutional: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
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
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  on_hold: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  won: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  lost: 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  closed: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
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
  pursuit: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
  capture: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  bid: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  award: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  mobilization: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30',
  execution: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  closeout: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
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
  info: 'bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
  watch: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  critical: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30',
  blocker: 'bg-red-100 text-red-700 ring-red-200 dark:bg-red-500/20 dark:text-red-300 dark:ring-red-500/35',
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
  llc: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  corp: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  jv: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  subsidiary: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  trust: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
  fund: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
  other: 'bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
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
  INSERT: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  UPDATE: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  DELETE: 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
}

// ─── Entity Relationships ────────────────────────────────────────────────────

export const RELATIONSHIP_LABELS: Record<string, string> = {
  owner: 'Owner',
  jv_partner: 'JV Partner',
  sub_entity: 'Sub-Entity',
  guarantor: 'Guarantor',
}

// ─── Capture / Bid management ────────────────────────────────────────────────

export type BidDecision = 'undecided' | 'pursue' | 'no_bid'

export const BID_DECISIONS: BidDecision[] = ['undecided', 'pursue', 'no_bid']

export const BID_DECISION_LABELS: Record<BidDecision, string> = {
  undecided: 'Go / No-Go Pending',
  pursue: 'Bid',
  no_bid: 'No-Bid',
}

export const BID_DECISION_SHORT: Record<BidDecision, string> = {
  undecided: 'Pending',
  pursue: 'Bid',
  no_bid: 'No-Bid',
}

export const BID_DECISION_BADGE: Record<BidDecision, string> = {
  undecided: 'bg-slate-100 text-slate-600 ring-slate-200',
  pursue: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  no_bid: 'bg-red-50 text-red-600 ring-red-200',
}

/** Normalize a possibly-null/legacy bid_decision value to a known key. */
export function bidDecision(value: string | null | undefined): BidDecision {
  return value === 'pursue' || value === 'no_bid' ? value : 'undecided'
}

/** Expected (probability-weighted) value of a pursuit. */
export function weightedValue(estimatedValue: number | null, winProbability: number | null): number {
  if (!estimatedValue || winProbability == null) return 0
  return estimatedValue * (winProbability / 100)
}

/** Color for a P-win badge, scaled by confidence. */
export function pwinBadge(p: number | null | undefined): string {
  if (p == null) return 'bg-slate-100 text-slate-500 ring-slate-200'
  if (p >= 60) return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (p >= 35) return 'bg-amber-50 text-amber-700 ring-amber-200'
  return 'bg-red-50 text-red-600 ring-red-200'
}

/** Whole days from today (local) until a date string; negative = overdue. */
export function daysUntilDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const target = new Date(dateStr + 'T00:00:00').getTime()
  return Math.round((target - todayStart) / 86_400_000)
}

/** Short human label for a bid deadline, e.g. "Due in 6d" / "Overdue 2d" / "Due today". */
export function bidDueLabel(dateStr: string | null | undefined): string | null {
  const d = daysUntilDate(dateStr)
  if (d == null) return null
  if (d < 0) return `Overdue ${Math.abs(d)}d`
  if (d === 0) return 'Due today'
  if (d === 1) return 'Due tomorrow'
  if (d <= 30) return `Due in ${d}d`
  return `Due ${new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

/** Urgency color band for a bid deadline. */
export function bidDueColor(dateStr: string | null | undefined): string {
  const d = daysUntilDate(dateStr)
  if (d == null) return 'text-muted-foreground'
  if (d < 0) return 'text-red-700'
  if (d <= 7) return 'text-red-600'
  if (d <= 21) return 'text-amber-600'
  return 'text-slate-600'
}

/** Parse a competitors JSON value (array of strings) defensively. */
export function parseCompetitors(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((x): x is string => typeof x === 'string')
  if (typeof val === 'string') {
    try {
      const p = JSON.parse(val)
      return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  return []
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

// ─── Project Player Roles ────────────────────────────────────────────────────

export const PROJECT_PLAYER_ROLES: { value: string; group: string }[] = [
  // Ownership & Development
  { value: 'Owner', group: 'Ownership & Development' },
  { value: "Owner's Rep", group: 'Ownership & Development' },
  { value: 'Developer', group: 'Ownership & Development' },
  { value: 'Co-Developer', group: 'Ownership & Development' },
  { value: 'JV Partner', group: 'Ownership & Development' },
  { value: 'PE Partner', group: 'Ownership & Development' },
  { value: 'Equity Investor', group: 'Ownership & Development' },
  // Construction
  { value: 'General Contractor (GC)', group: 'Construction' },
  { value: 'Construction Manager (CM)', group: 'Construction' },
  { value: 'Subcontractor', group: 'Construction' },
  { value: 'Project Manager', group: 'Construction' },
  { value: 'Superintendent', group: 'Construction' },
  // Design
  { value: 'Architect', group: 'Design' },
  { value: 'Structural Engineer', group: 'Design' },
  { value: 'Civil Engineer', group: 'Design' },
  { value: 'MEP Engineer', group: 'Design' },
  { value: 'Geotechnical Engineer', group: 'Design' },
  // Finance & Legal
  { value: 'Lender', group: 'Finance & Legal' },
  { value: 'Senior Lender', group: 'Finance & Legal' },
  { value: 'Mezzanine Lender', group: 'Finance & Legal' },
  { value: 'Legal Counsel', group: 'Finance & Legal' },
  { value: 'Title Company', group: 'Finance & Legal' },
  { value: 'Accountant / CPA', group: 'Finance & Legal' },
  { value: 'Insurance Broker', group: 'Finance & Legal' },
  // Government
  { value: 'Contracting Officer (CO)', group: 'Government' },
  { value: 'Contracting Officer Rep (COR)', group: 'Government' },
  { value: 'Government PM', group: 'Government' },
  // Consultants & Other
  { value: 'Environmental Consultant', group: 'Consultants & Other' },
  { value: 'Permitting Consultant', group: 'Consultants & Other' },
  { value: 'Surveyor', group: 'Consultants & Other' },
  { value: 'Property Manager', group: 'Consultants & Other' },
  { value: 'Broker', group: 'Consultants & Other' },
  { value: 'DBE Consultant', group: 'Consultants & Other' },
]

export const PROJECT_PLAYER_ROLE_GROUPS = [
  'Ownership & Development',
  'Construction',
  'Design',
  'Finance & Legal',
  'Government',
  'Consultants & Other',
]

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

// ─── Entity Categories ────────────────────────────────────────────────────

export type EntityCategory = 'vendor' | 'partner' | 'contractor'

export const ENTITY_CATEGORIES: EntityCategory[] = ['vendor', 'partner', 'contractor']

export const ENTITY_CATEGORY_LABELS: Record<EntityCategory, string> = {
  vendor: 'Vendor',
  partner: 'Partner',
  contractor: 'Contractor',
}

export const ENTITY_CATEGORY_BADGE: Record<EntityCategory, string> = {
  vendor: 'bg-blue-50 text-blue-700 ring-blue-200',
  partner: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  contractor: 'bg-amber-50 text-amber-700 ring-amber-200',
}

// ─── Federal Standards ──────────────────────────────────────────────────────

export type FederalStandard = 'usace_qm' | 'dod_385'

export const FEDERAL_STANDARDS: FederalStandard[] = ['usace_qm', 'dod_385']

export const FEDERAL_STANDARD_LABELS: Record<FederalStandard, string> = {
  usace_qm: 'USACE Quality Management',
  dod_385: 'DoD 385-1-1 Safety & Health',
}

export const FEDERAL_STANDARD_DESCRIPTIONS: Record<FederalStandard, string> = {
  usace_qm: 'U.S. Army Corps of Engineers Quality Management System (ER 1180-1-6 / EP 715-1-7) — Contractor Quality Control requirements for federal construction',
  dod_385: 'Department of Defense Instruction 385-1-1 — Safety and Occupational Health program requirements for DoD construction operations',
}

export const FEDERAL_STANDARD_BADGE: Record<FederalStandard, string> = {
  usace_qm: 'bg-blue-50 text-blue-700 ring-blue-200',
  dod_385: 'bg-orange-50 text-orange-700 ring-orange-200',
}

// USACE Quality Management scorecard criteria
export const USACE_QM_CRITERIA = [
  { key: 'qm_qc_plan', label: 'Quality Control Plan', description: 'Adequacy and implementation of the Contractor Quality Control (CQC) plan per ER 1180-1-6' },
  { key: 'qm_three_phase_inspection', label: 'Three-Phase Inspection', description: 'Compliance with preparatory, initial, and follow-up inspection phases' },
  { key: 'qm_testing_compliance', label: 'Testing Compliance', description: 'Required testing performed per specifications and accepted standards' },
  { key: 'qm_deficiency_tracking', label: 'Deficiency Tracking', description: 'Timely identification, documentation, and resolution of deficiencies' },
  { key: 'qm_documentation', label: 'Documentation', description: 'Completeness of daily reports, test results, and QC records' },
  { key: 'qm_rework_rate', label: 'Rework Rate', description: 'Volume and impact of rework relative to contract value' },
  { key: 'qm_material_compliance', label: 'Material Compliance', description: 'Material certifications, approved sources, and specification conformance' },
  { key: 'qm_submittal_timeliness', label: 'Submittal Timeliness', description: 'On-time submission and quality of submittals and shop drawings' },
] as const

// DoD 385-1-1 Safety & Health scorecard criteria
export const DOD_385_CRITERIA = [
  { key: 'sh_accident_prevention_plan', label: 'Accident Prevention Plan', description: 'Adequacy and implementation of the APP per EM 385-1-1' },
  { key: 'sh_activity_hazard_analysis', label: 'Activity Hazard Analysis', description: 'Completion and quality of AHAs for each definable feature of work' },
  { key: 'sh_safety_training', label: 'Safety Training', description: 'Required safety training, toolbox talks, and competent person certifications' },
  { key: 'sh_ppe_compliance', label: 'PPE Compliance', description: 'Proper personal protective equipment use and enforcement' },
  { key: 'sh_incident_rate', label: 'Incident Rate', description: 'DART rate, TRIR, and severity of recordable incidents' },
  { key: 'sh_site_inspections', label: 'Site Safety Inspections', description: 'Frequency and thoroughness of daily and weekly safety inspections' },
  { key: 'sh_osha_compliance', label: 'OSHA Compliance', description: 'Compliance with OSHA 300 log, reporting requirements, and citations' },
  { key: 'sh_corrective_actions', label: 'Corrective Actions', description: 'Timeliness and effectiveness of corrective actions for safety deficiencies' },
] as const

// Scorecard rating scale labels
export const SCORECARD_RATING_LABELS: Record<number, string> = {
  0: 'Not Evaluated',
  1: 'Unsatisfactory',
  2: 'Below Standard',
  3: 'Satisfactory',
  4: 'Above Standard',
  5: 'Exceptional',
}

export const SCORECARD_RATING_COLORS: Record<number, string> = {
  0: 'text-slate-400',
  1: 'text-red-600',
  2: 'text-orange-500',
  3: 'text-amber-500',
  4: 'text-emerald-500',
  5: 'text-green-600',
}
