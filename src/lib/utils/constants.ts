/**
 * Centralized constants for the platform.
 * All enum values, labels, badge styles, and display mappings live here.
 * Import from this file instead of scattering magic strings across components.
 */

import type {
  ProjectSector,
  ProjectStatus,
  DealStage,
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

/*
  ⚠ EVERY SECTOR IS A `CategoryTone`, AND FOUR OF THEM WERE NOT.
  `government` wore `info`, `infrastructure` wore `caution`, `real_estate`
  wore `positive` and `institutional` wore `neutral` — four STATUS tones, the
  ones whose entire job elsewhere is to say a thing is wrong, waiting or well.
  A government project is not "informational" and an infrastructure project is
  not a warning, so on any screen carrying both a sector chip and a status
  chip the reader had to know which palette each came from.

  That is also what the audit saw as "Gov't and Tech are both blue": `info`
  and `sky` are two blues from two different vocabularies, arriving beside each
  other by accident rather than by assignment.

  Seven sectors, seven category tones, each used exactly once. Identity here is
  never colour alone — a chip carries its own label — which is what makes a
  low-chroma outline enough.
*/
export const SECTOR_BADGE: Record<ProjectSector, string> = {
  government: chipTone('indigo'),
  infrastructure: chipTone('orange'),
  real_estate: chipTone('teal'),
  prefab: chipTone('violet'),
  institutional: chipTone('cyan'),
  technology: chipTone('sky'),
  health: chipTone('rose'),
}

// ─── Statuses ────────────────────────────────────────────────────────────────

/*
  ⚠ A PARKING FLAG, NOT AN OUTCOME (narrowed 2026-10-30).

  This held active / on_hold / won / lost / closed. Three of those are outcomes,
  and `stage` now owns outcomes — so "did we win it?" had two homes that could
  disagree, with nothing stopping a row reading `stage='won', status='active'`.
  Measured before narrowing: 20 active, 3 on_hold, and ZERO rows in won, lost or
  closed, so the three members were never the answer to anything.

  What is left is the one question `stage` cannot answer: is this deal being
  worked right now, or parked? A parked deal keeps its pipeline position.
*/

export const STATUSES: ProjectStatus[] = ['active', 'on_hold']

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  on_hold: 'On Hold',
}

export const STATUS_BADGE: Record<ProjectStatus, string> = {
  active: chipTone('positive'),
  on_hold: chipTone('caution'),
}

// ─── Stages ──────────────────────────────────────────────────────────────────

/*
  THE PIPELINE, AND THE ONLY VOCABULARY FOR IT (Richard, 2026-10-30):
  *"For stages lets put Prospecting, In Discussions, Due Diligence,
  Contracting, Won, Lost"*.

  ⚠ ONE LIST FOR BOTH BOARDS. `projects` carried a seven-member
  defence-contracting lifecycle (pursuit → capture → bid → award →
  mobilization → execution → closeout) of which four members had never been
  used by a single row, while `opportunities` carried nine statuses of its own.
  The back half of the project list described DELIVERY, which is what
  milestones are for — not a position in a pipeline. Both tables now hold a
  `stage` column on `deal_stage` and read these same maps.

  ⚠ STAGE OWNS THE OUTCOME. `Won` and `Lost` live here and nowhere else;
  `status` is a parking flag (Active / On Hold) and says nothing about whether
  a deal was won. Two fields answering "did we get it?" is the failure §12 calls
  one-quantity-one-definition, and before 10-30 `project_status` had won/lost/
  closed members sitting right beside these.

  Every map below is `Record<DealStage, …>` on purpose — the TYPE is what ends
  the drift, not the derivation (§12). Adding a member to the enum breaks the
  build in each of these five places until it is given a label, an order, a
  chip, a bar colour and a card border.
*/

export const STAGES: DealStage[] = [
  'prospecting', 'in_discussions', 'due_diligence', 'contracting', 'won', 'lost',
]

/**
 * The stages a LIVE deal can sit in — the board's lanes.
 *
 * ⚠ Won and Lost are outcomes, not places work waits. A board that lanes them
 * accumulates every deal the company has ever closed in two columns on the
 * right, which is a filing cabinet rather than a pipeline. They stay in
 * `STAGES` (a deal can be moved there, and the chip must render) and out of
 * the default lanes.
 */
export const STAGE_PIPELINE: DealStage[] = [
  'prospecting', 'in_discussions', 'due_diligence', 'contracting',
]

/** The two terminal stages — a deal here is decided, either way. */
export const STAGE_CLOSED: DealStage[] = ['won', 'lost']

export const STAGE_LABELS: Record<DealStage, string> = {
  prospecting: 'Prospecting',
  in_discussions: 'In Discussions',
  due_diligence: 'Due Diligence',
  contracting: 'Contracting',
  won: 'Won',
  lost: 'Lost',
}

export const STAGE_INDEX: Record<DealStage, number> = {
  prospecting: 0,
  in_discussions: 1,
  due_diligence: 2,
  contracting: 3,
  won: 4,
  lost: 5,
}

export const STAGE_BADGE: Record<DealStage, string> = {
  prospecting: chipTone('neutral'),
  in_discussions: chipTone('cyan'),
  due_diligence: chipTone('caution'),
  contracting: chipTone('violet'),
  won: chipTone('positive'),
  lost: chipTone('critical'),
}

export const STAGE_COLOR: Record<DealStage, string> = {
  prospecting: 'bg-muted-foreground/60',
  in_discussions: 'bg-cyan-500',
  due_diligence: 'bg-amber-500',
  contracting: 'bg-violet-500',
  won: 'bg-emerald-500',
  lost: 'bg-red-500',
}

export const STAGE_BORDER: Record<DealStage, string> = {
  prospecting: 'border-l-border [--card-glow-color:oklch(0.60_0_0)]',
  in_discussions: 'border-l-cyan-400 [--card-glow-color:oklch(0.60_0.12_200)]',
  due_diligence: 'border-l-amber-400 [--card-glow-color:oklch(0.70_0.12_85)]',
  contracting: 'border-l-violet-400 [--card-glow-color:oklch(0.55_0.18_290)]',
  won: 'border-l-emerald-400 [--card-glow-color:oklch(0.55_0.15_145)]',
  lost: 'border-l-red-400 [--card-glow-color:oklch(0.55_0.18_25)]',
}

/**
 * Ink to match each stage's chip — the LABEL colour, where STAGE_COLOR is the
 * bar fill.
 *
 * ⚠ ITS HOME IS HERE, BESIDE THE OTHER FOUR MAPS. This lived in
 * `StageIndicator.tsx` as a private `Record<DealStage, string>`, which is a
 * fifth stage map in a component — exactly the hand-written enumeration beside
 * a registry that §12 warns drifts, and it would have been the one place a new
 * member silently rendered unstyled.
 */
export const STAGE_TEXT: Record<DealStage, string> = {
  prospecting: 'text-muted-foreground',
  in_discussions: 'text-cyan-600 dark:text-cyan-400',
  due_diligence: 'text-caution',
  contracting: 'text-violet-600 dark:text-violet-400',
  won: 'text-positive',
  lost: 'text-critical',
}

/**
 * The stage vocabulary as a model is told it — pipe-joined, in order.
 *
 * ⚠ GENERATED, NEVER TYPED INTO A PROMPT. §12: a taxonomy written into a
 * prompt is a second schema and it drifts silently, because a category the
 * model was never told about simply never fires. Six prompts each held their
 * own copy of `pursuit | capture | bid | award | mobilization | execution |
 * closeout` — one of them with a worked example per member — so the renaming
 * on 10-30 would have left every extraction proposing stages the enum no
 * longer has, and a value outside an enum discards the WHOLE insert (§12).
 *
 * Every prompt that enumerates stages now interpolates this.
 */
export const STAGE_ENUM_FOR_PROMPT = STAGES.join(' | ')

/** The same list as an arrow-joined funnel, for prose that describes order. */
export const STAGE_FUNNEL_FOR_PROMPT = STAGE_PIPELINE.map((s) => STAGE_LABELS[s]).join(' → ')

/** Is this a member of the live vocabulary? Narrows an unknown string. */
export function isDealStage(value: unknown): value is DealStage {
  return typeof value === 'string' && (STAGES as string[]).includes(value)
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

/*
  ─── Capture / Bid management ──────────────────────────────────────────────

  ⚠ THE BID DECISION VOCABULARY WAS REMOVED 2026-10-31 (Richard: *"On the
  project level get rid of decision, ntp and substantial completion"*), along
  with the `projects.bid_decision` column itself.

  It was a second answer to a question `deal_stage` already owns. §4 states the
  rule for the pair it replaced — STAGE OWNS THE OUTCOME, and two fields
  answering "are we going after this?" is one-quantity-two-definitions. A deal
  sitting in `in_discussions` with a Decision of "Go / No-Go Pending" is the
  contradiction that rule exists to prevent, and 22 of 24 projects read exactly
  that way.

  Measured before removing: 22 `undecided`, 2 `pursue`, 0 `no_bid` — so the
  only thing it ever said was already legible from the stage.
*/

/** Expected (probability-weighted) value of a pursuit. */
export function weightedValue(estimatedValue: number | null, winProbability: number | null): number {
  if (!estimatedValue || winProbability == null) return 0
  return estimatedValue * (winProbability / 100)
}

// ─── Win probability ─────────────────────────────────────────────────────────

/*
  LOW / MEDIUM / HIGH, PICKED BY HAND (Richard, 2026-10-30):
  *"Make it so we can manually select win probability. Low, Medium and High."*

  ⚠ THE COLUMN STAYS `win_probability int4` AND THAT IS DELIBERATE. A band is
  what a human can honestly assert about a deal; a percentage is what the
  arithmetic needs — `weightedValue()` multiplies by it, and the weighted
  pipeline figure on the board, the dashboard and `snapshot.ts` all read that
  product. Storing the band as text would have meant either losing the weighted
  figure or re-deriving a percentage from the band at four call sites, which is
  the same mapping written four times (§12). So the band IS a percentage, with
  ONE place that says which: `WIN_BAND_VALUE` below.

  ⚠ AND THE READER IS SHOWN THE BAND, NEVER THE NUMBER. Printing "25%" back at
  somebody who chose "Low" is inventing a precision they did not assert — the
  same reason §12 forbids printing a stored enum at a reader. `winBandLabel()`
  is what every surface renders.

  Measured before choosing the numbers: 21 of 23 projects held NULL and the
  two that were set held 80 and 99, so nothing real is reinterpreted by this —
  both land in High, which is what they meant.
*/

export const WIN_BANDS = ['low', 'medium', 'high'] as const
export type WinBand = (typeof WIN_BANDS)[number]

/**
 * The percentage each band is stored as — the ONE place the mapping lives.
 *
 * The midpoint of each third, so a band is never a claim about the edge of its
 * own range: Low is "a long shot", not "exactly one in four".
 */
export const WIN_BAND_VALUE: Record<WinBand, number> = {
  low: 20,
  medium: 50,
  high: 80,
}

export const WIN_BAND_LABELS: Record<WinBand, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export const WIN_BAND_BADGE: Record<WinBand, string> = {
  low: chipTone('critical'),
  medium: chipTone('caution'),
  high: chipTone('positive'),
}

/** The bar's fill, for the meter under the badge. */
export const WIN_BAND_COLOR: Record<WinBand, string> = {
  low: 'bg-critical',
  medium: 'bg-caution',
  high: 'bg-positive',
}

/**
 * Which band a stored percentage falls in.
 *
 * ⚠ THE BOUNDARIES ARE WIDE ON PURPOSE, because this reads values no picker
 * wrote. Two projects carry 80 and 99 from the old free-text field, and a
 * brief or an import may yet supply any integer. Anything from 35 up is High,
 * anything under 35 that is still positive is Low, and the middle third is
 * Medium — so an old number is always readable as one of the three rather than
 * rendering blank.
 */
export function winBand(p: number | null | undefined): WinBand | null {
  if (p == null) return null
  if (p >= 65) return 'high'
  if (p >= 35) return 'medium'
  return 'low'
}

/** What a reader sees. Null for "not set" — the caller decides how to say that. */
export function winBandLabel(p: number | null | undefined): string | null {
  const band = winBand(p)
  return band ? WIN_BAND_LABELS[band] : null
}

/** Colour for a win-probability chip, by band. */
export function pwinBadge(p: number | null | undefined): string {
  const band = winBand(p)
  return band ? WIN_BAND_BADGE[band] : chipTone('neutral')
}

/** Is this one of the three bands? Narrows a value off the wire. */
export function isWinBand(value: unknown): value is WinBand {
  return typeof value === 'string' && (WIN_BANDS as readonly string[]).includes(value)
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
