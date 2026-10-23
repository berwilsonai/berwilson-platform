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
import { chipTone, inkTone } from '@/lib/ui/tone'

// ─── Sectors ─────────────────────────────────────────────────────────────────

export const SECTORS: ProjectSector[] = [
  'government', 'infrastructure', 'real_estate', 'prefab', 'institutional', 'technology', 'health',
]

export const SECTOR_LABELS: Record<ProjectSector, string> = {
  government: 'Government',
  infrastructure: 'Infrastructure',
  real_estate: 'Real Estate',
  prefab: 'Prefab',
  institutional: 'Institutional',
  technology: 'Technology',
  health: 'Health',
}

export const SECTOR_SHORT: Record<ProjectSector, string> = {
  government: "Gov't",
  infrastructure: 'Infra',
  real_estate: 'Real Estate',
  prefab: 'Prefab',
  institutional: 'Institutional',
  technology: 'Tech',
  health: 'Health',
}

export const SECTOR_BADGE: Record<ProjectSector, string> = {
  government: chipTone('info'),
  infrastructure: chipTone('caution'),
  real_estate: chipTone('positive'),
  prefab: chipTone('violet'),
  institutional: chipTone('neutral'),
  technology: chipTone('sky'),
  health: chipTone('rose'),
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
  active: chipTone('positive'),
  on_hold: chipTone('caution'),
  won: chipTone('info'),
  lost: chipTone('critical'),
  closed: chipTone('neutral'),
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
  pursuit: chipTone('neutral'),
  capture: chipTone('violet'),
  bid: chipTone('caution'),
  award: chipTone('info'),
  mobilization: chipTone('cyan'),
  execution: chipTone('positive'),
  closeout: chipTone('indigo'),
}

export const STAGE_COLOR: Record<ProjectStage, string> = {
  pursuit: 'bg-muted-foreground/60',
  capture: 'bg-violet-500',
  bid: 'bg-amber-500',
  award: 'bg-blue-500',
  mobilization: 'bg-cyan-500',
  execution: 'bg-emerald-500',
  closeout: 'bg-indigo-500',
}

export const STAGE_BORDER: Record<ProjectStage, string> = {
  pursuit: 'border-l-border [--card-glow-color:oklch(0.60_0_0)]',
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
  info: chipTone('neutral'),
  watch: chipTone('caution'),
  critical: chipTone('orange'),
  blocker: chipTone('critical'),
}

/**
 * Where a diligence item stands.
 *
 * ⚠ `dd_items.status` IS PLAIN TEXT WITH NO CHECK, so this list is the only
 * definition there is — and it lived inside DiligenceTab.tsx until 2026-10-19,
 * where the registry that validates the column could not see it (§12 — a
 * hand-written enumeration beside a registry drifts). Both the form and
 * src/lib/records/children.ts read it from here now.
 */
export const DD_STATUSES = ['open', 'in_progress', 'resolved', 'accepted_risk'] as const

export const DD_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  accepted_risk: 'Accepted Risk',
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
  llc: chipTone('info'),
  corp: chipTone('violet'),
  jv: chipTone('positive'),
  subsidiary: chipTone('caution'),
  trust: chipTone('rose'),
  fund: chipTone('indigo'),
  other: chipTone('neutral'),
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
  // Governance, 2026-09-30. The first seven of these were already live tables
  // with no activity trigger at all, so /activity has never had a reason to
  // label them; enumLabel's humanising fallback would print "Org People" and
  // "Personnel Note Kinds", which is the schema leaking through the page (§7).
  team_members: 'Team access',
  access_grants: 'Access grants',
  org_people: 'Org chart — people',
  org_nodes: 'Org chart — entities',
  meetings: 'Meetings',
  company_profile: 'Company profile',
  certifications: 'Certifications',
  personnel: 'Personnel',
  personnel_notes: 'Personnel file',
  personnel_agreements: 'Personnel agreements',
  personnel_offboarding: 'Offboarding',
  personnel_note_kinds: 'Note kinds',
  resolutions: 'Resolutions',
  org_roles: 'Appointments',
  ownership_interests: 'Ownership',
  entity_obligations: 'Filing calendar',
  conflict_disclosures: 'Conflict disclosures',
  related_party_transactions: 'Related-party',
  policies: 'Policies',
  policy_acknowledgements: 'Policy acknowledgements',
  // Was only in /activity's own local copy of this map, which is how the two
  // drifted: governance existed here and not there, dev_notes there and not
  // here. The page now reads this map and the duplicate is gone.
  dev_notes: 'Developer Notes',
  project_spvs: 'Vehicles (SPVs)',
  project_spv_participants: 'Vehicle participants',
  // ⚠ THESE THREE TABLES NO LONGER EXIST AND THEIR LABELS MUST STAY. The deal
  // economics calculator was removed on 2026-10-23, but `activity_log` is
  // append-only (§4) and still holds 248 rows naming them — 210
  // `economics_buckets`, 30 `deal_economics`, 8 `economics_benchmarks`,
  // counted before the drop. Without a label `enumLabel`'s humanising fallback
  // prints "Economics Buckets" at a reader, which is the schema leaking
  // through the page (§7). The set is frozen: nothing can write these again.
  // The five economics tables with no history are deliberately NOT listed —
  // a label for a table no row will ever name is decoration.
  deal_economics: 'Deal economics',
  economics_buckets: 'Economics — allocation',
  economics_benchmarks: 'Benchmark library',
}

export const ACTIVITY_ACTION_STYLES: Record<string, string> = {
  INSERT: chipTone('positive'),
  UPDATE: chipTone('info'),
  DELETE: chipTone('critical'),
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
  undecided: chipTone('neutral'),
  pursue: chipTone('positive'),
  no_bid: chipTone('critical'),
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
  if (p == null) return chipTone('neutral')
  if (p >= 60) return chipTone('positive')
  if (p >= 35) return chipTone('caution')
  return chipTone('critical')
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
/**
 * ⚠ RETURNED A BARE PALETTE COLOUR WITH NO `dark:` VARIANT, so an overdue bid
 * date rendered `text-red-700` on a dark card — legible in one theme and murky
 * in the other, on the single most time-critical figure on a project. The two
 * red levels (700 for overdue, 600 for within a week) were also imperceptibly
 * different; urgency is carried by the words beside it, not by that 1 step.
 */
export function bidDueColor(dateStr: string | null | undefined): string {
  const d = daysUntilDate(dateStr)
  if (d == null) return 'text-muted-foreground'
  if (d <= 7) return inkTone('critical')
  if (d <= 21) return inkTone('caution')
  return 'text-muted-foreground'
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

/**
 * Exact dollars, e.g. "$2,131,200". Use this anywhere a number is contractual —
 * a quote, an invoice, a signed document. `formatValue` below abbreviates to
 * "$2.1M", which is right on a dashboard and wrong on a page a customer signs.
 */
export function formatMoney(value: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (value === null || value === undefined || !isFinite(value)) return '—'
  const digits = opts.cents ? 2 : 0
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

/** A $/SF rate to two decimals, e.g. "$33.00/SF". Null when there is no rate to state. */
export function formatRatePerSqft(value: number | null | undefined): string {
  if (value === null || value === undefined || !isFinite(value)) return '—'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/SF`
}

/**
 * A percentage, for a reader rather than for arithmetic.
 *
 * The repo had no percent formatter at all and every call site did its own
 * `(a / b) * 100` with its own rounding, which is how `FinancingTab` ended up
 * showing two decimals where the projects list showed none. One decimal, the
 * sign kept, and `'—'` for null so a missing figure cannot read as 0%.
 *
 * ⚠ The caller passes 0 to 100, NOT 0 to 1. Every percent column in this
 * schema is stored that way (`equity_pct`, `win_probability`,
 * `bw_ownership_pct`), so a helper that expected a fraction would silently
 * render 60% as 0.6%.
 */
export function formatPercent(
  value: number | null | undefined,
  opts: { decimals?: number; empty?: string } = {}
): string {
  if (value == null || !Number.isFinite(value)) return opts.empty ?? '—'
  return `${value.toFixed(opts.decimals ?? 1)}%`
}

/**
 * Money, abbreviated. The dashboard/card/KPI form.
 *
 * ONE DECIMAL AT EVERY TIER. It used to be two at the billion mark and one at
 * the million, which is why the same figure read `$2.1M` on the Projects page
 * and `$2.13M` on the Financing tab — three shadow copies of this function
 * each picked their own precision.
 *
 * The magnitude tests take the ABSOLUTE value. Unsigned guards sent every
 * negative straight to the last line, so a −$2.5M variance rendered as the
 * unreadable `$-2,500,000`.
 */
export function formatValue(value: number | null): string {
  if (value === null || value === undefined || !isFinite(value)) return '—'
  // The sign goes OUTSIDE the currency symbol — `-$2.5M`, never `$-2.5M`.
  const sign = value < 0 ? '-' : ''
  const mag = Math.abs(value)
  // One decimal, and never a trailing `.0` — a round twelve million is
  // "$12M", not "$12.0M". The decimal is there to distinguish 12.4 from 12.8,
  // and a zero after the point distinguishes nothing.
  const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '')
  if (mag >= 1_000_000_000) return `${sign}$${trim(mag / 1_000_000_000)}B`
  if (mag >= 1_000_000) return `${sign}$${trim(mag / 1_000_000)}M`
  if (mag >= 1_000) return `${sign}$${(mag / 1_000).toFixed(0)}K`
  return `${sign}$${mag.toLocaleString()}`
}

/**
 * The one date formatter. Every surface goes through this.
 *
 * There were nine copies of this function, and eight of them lacked the
 * normalisation below — which exists because it was a real, reported bug. Two
 * of those copies formatted DATE columns (`tasks.due_date` via `dueLabel`, and
 * `objectives.target_date`), so a task due the 1st rendered as the 30th for
 * anyone west of UTC.
 *
 * The options exist only to preserve what the call sites already did: some
 * render an em dash for a missing date and some render nothing, and a task
 * chip omits the year because the board is a this-quarter view. Consolidating
 * without them would have silently changed what several screens display.
 */
export function formatDate(
  dateStr: string | null | undefined,
  opts: { empty?: string; year?: boolean } = {}
): string {
  const { empty = '—', year = true } = opts
  if (!dateStr) return empty
  // Date-only strings (YYYY-MM-DD) parse as UTC midnight, which renders as the
  // previous day in US timezones — pin them to local midnight instead.
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return empty
  return d.toLocaleDateString('en-US', {
    ...(year ? { year: 'numeric' as const } : {}),
    month: 'short',
    day: 'numeric',
  })
}

// ─── Enum labels ─────────────────────────────────────────────────────────────

/**
 * Render a stored enum value as English.
 *
 * Pass the matching `*_LABELS` map where one exists. The fallback matters as
 * much as the map: several of these columns are NOT controlled enums —
 * `projects.contract_type` offers FFP/CPFF/GMP through the form, while email
 * intake and lead promotion write values like `joint_venture`. A map-only
 * lookup renders those blank; a humanising fallback renders "Joint Venture".
 *
 * Never print a raw stored value at a reader. `joint_venture` on a contract
 * line is the schema leaking through the page.
 */
export function enumLabel(
  value: string | null | undefined,
  map?: Record<string, string>,
  opts: { empty?: string } = {}
): string {
  const { empty = '—' } = opts
  if (!value) return empty
  const mapped = map?.[value]
  if (mapped) return mapped
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    // An all-caps token is already an acronym (FFP, GMP, T&M) — leave it.
    .map((w) => (w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

// ─── Project Player Roles ────────────────────────────────────────────────────

/*
 * PROJECT_PLAYER_ROLES and PROJECT_PLAYER_ROLE_GROUPS lived here and are GONE
 * (2026-10-21). They were 33 hand-written role values in six groups, read by
 * AddPlayerModal and EditRoleButton and by nothing else — and 1 of 104 live
 * `project_players` rows conformed to them, because every automated writer
 * (the mail sweep, the meeting confirm, the proposal confirm) passed the
 * model's prose straight through and the model was never shown the list.
 *
 * The vocabulary is now the `contact_roles` TABLE, read through
 * `src/lib/contacts/roles.ts` and rendered through
 * `src/lib/utils/contact-roles.ts`. Every value above was carried into its
 * seed (migration 20261021000004) along with the categories the live corpus
 * demanded. Adding a role is an INSERT at /settings/contact-roles.
 *
 * §12: a taxonomy written into a prompt is a second schema and it drifts
 * silently — so generate the enumeration from the same rows the column
 * references. This one was not even in the prompt.
 */

// ─── Entity Categories ────────────────────────────────────────────────────

export type EntityCategory = 'vendor' | 'partner' | 'contractor'

export const ENTITY_CATEGORIES: EntityCategory[] = ['vendor', 'partner', 'contractor']

export const ENTITY_CATEGORY_LABELS: Record<EntityCategory, string> = {
  vendor: 'Vendor',
  partner: 'Partner',
  contractor: 'Contractor',
}

export const ENTITY_CATEGORY_BADGE: Record<EntityCategory, string> = {
  vendor: chipTone('info'),
  partner: chipTone('positive'),
  contractor: chipTone('caution'),
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
  usace_qm: chipTone('info'),
  dod_385: chipTone('orange'),
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

/** Also carried no dark variant — see the note on `bidDueColor`. */
export const SCORECARD_RATING_COLORS: Record<number, string> = {
  0: 'text-muted-foreground',
  1: inkTone('critical'),
  2: inkTone('orange'),
  3: inkTone('caution'),
  4: inkTone('positive'),
  5: inkTone('positive'),
}
