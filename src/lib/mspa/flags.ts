/**
 * Part F — the flags raised automatically, rather than smoothed over.
 *
 * ⚠ A FLAG IS NOT A WARNING ABOUT ARITHMETIC. The engine's arithmetic is
 * sound; these are inconsistencies in what we have been TOLD. A capacity in
 * gigawatts where megawatts are meant, a project TensorIQ claims that is
 * already on Ber Wilson's own register, a portfolio total that does not
 * reconcile with its own pipeline — each is a question for a counterparty, and
 * the brief is explicit that they must be raised rather than resolved quietly.
 *
 * Pure, sibling imports only. Safe for a verification script.
 */

import type { MwBasis } from './capacity'
import { AGGREGATE_FEE_CAP_PCT, type PhaseFeeResult } from './fees'

export type FlagSeverity = 'blocker' | 'question' | 'note'

export interface Flag {
  severity: FlagSeverity
  /** A short stable key, so a flag can be dismissed or counted. */
  code: string
  title: string
  detail: string
  /** What would clear it. */
  resolution: string
}

// ── Ber Wilson's own Project Register. ──────────────────────────────────────

export interface RegisterEntry {
  name: string
  state: string
  /** Aliases TensorIQ's materials might use for the same site. */
  aliases: readonly string[]
  active: boolean
}

/**
 * The register, as it stands on the platform.
 *
 * ⚠ RIVERDALE IS IN COOK COUNTY, ILLINOIS — WHICH IS CHICAGO. So a TensorIQ
 * line reading "Chicago" is very likely Riverdale under another name rather
 * than a separate opportunity, and the same goes for a bare "West Virginia"
 * against Weirton. Those are the duplicate claims this list exists to catch.
 */
export const PROJECT_REGISTER: readonly RegisterEntry[] = [
  { name: 'Steelton', state: 'PA', aliases: ['steelton', 'dauphin'], active: true },
  {
    name: 'Weirton',
    state: 'WV',
    aliases: ['weirton', 'hancock county', 'west virginia', 'western wv', 'western, wv'],
    active: true,
  },
  {
    name: 'Riverdale',
    state: 'IL',
    aliases: ['riverdale', 'cook county', 'chicago'],
    active: true,
  },
  { name: 'Myton', state: 'UT', aliases: ['myton', 'duchesne'], active: true },
  {
    name: 'Millard County (Delta)',
    state: 'UT',
    aliases: ['delta', 'millard', 'daves farms'],
    active: true,
  },
  // ⚠ NOT PRESENT ON THE PLATFORM. Named in the brief's register but there is
  // no project or opportunity record for it, so nothing can be computed.
  { name: 'Eagle Mountain', state: 'UT', aliases: ['eagle mountain'], active: true },
  { name: 'Heber', state: 'UT', aliases: ['heber', 'wasatch'], active: true },
]

/** Entries explicitly retired, which must not be treated as live opportunities. */
export const RETIRED_CLAIMS: readonly string[] = [
  'chicago',
  'west virginia',
  'allentown',
]

/** US state codes, for catching a place/state mismatch. */
const STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
])

/**
 * Places whose stated state code is wrong in TensorIQ's materials, with what it
 * most likely should be. Each is a question, never an auto-correction.
 */
export const SUSPECT_PLACES: readonly {
  place: string
  statedState: string
  likelyState: string
  why: string
}[] = [
  {
    place: 'Newport',
    statedState: 'AK',
    likelyState: 'AR',
    why: 'There is no Newport, Alaska of any size. Newport, Arkansas is a real place, and AR is one keystroke from AK.',
  },
  {
    place: 'Calgary',
    statedState: 'CA',
    likelyState: 'AB',
    why: 'Calgary is in Alberta, Canada. "CA" reads as California in a US state column, and a 2,000 MW line is too large to leave mislabelled.',
  },
]

export interface CapacityClaim {
  label: string
  /** The figure exactly as stated. */
  statedValue: number
  statedUnit: 'MW' | 'GW'
  basis: MwBasis | null
  state?: string | null
}

/**
 * Flags on a single capacity claim.
 *
 * A gigawatt figure is treated as suspect by default: 800 GW is roughly
 * two-thirds of the entire generating capacity of the United States, so it is
 * a unit error rather than an opportunity.
 */
export function flagCapacityClaim(claim: CapacityClaim): Flag[] {
  const flags: Flag[] = []

  if (claim.basis == null) {
    flags.push({
      severity: 'blocker',
      code: 'mw_basis_unconfirmed',
      title: `MW basis unconfirmed on ${claim.label}`,
      detail: `"${claim.statedValue} ${claim.statedUnit}" does not say whether it is IT load or utility load. At PUE 1.4 the two readings differ by 40% in capacity and by roughly the same in every fee, cost and return downstream.`,
      resolution:
        'Ask which load the figure is measured at. A Planned IT Capacity in a PCA is IT load; a figure quoted by a city or utility is almost always total draw.',
    })
  }

  if (claim.statedUnit === 'GW') {
    const asMw = claim.statedValue * 1000
    flags.push({
      severity: 'blocker',
      code: 'gigawatt_suspect',
      title: `${claim.label} is stated in gigawatts`,
      detail: `${claim.statedValue} GW is ${asMw.toLocaleString()} MW. For scale, total US generating capacity is roughly 1,200 GW, so this is almost certainly ${claim.statedValue} MW mislabelled.`,
      resolution: `Confirm whether ${claim.statedValue} MW was meant. Nothing downstream should be computed on the GW figure.`,
    })
  }

  if (claim.state) {
    const code = claim.state.trim().toUpperCase()
    const suspect = SUSPECT_PLACES.find(
      (p) =>
        claim.label.toLowerCase().includes(p.place.toLowerCase()) &&
        code === p.statedState
    )
    if (suspect) {
      flags.push({
        severity: 'question',
        code: 'place_state_mismatch',
        title: `${suspect.place}, ${suspect.statedState} looks wrong`,
        detail: suspect.why,
        resolution: `Confirm whether ${suspect.place}, ${suspect.likelyState} was meant.`,
      })
    } else if (code.length === 2 && !STATE_CODES.has(code)) {
      flags.push({
        severity: 'question',
        code: 'unknown_state_code',
        title: `"${claim.state}" is not a US state code`,
        detail: `${claim.label} is filed under "${claim.state}", which is not a US state or DC.`,
        resolution: 'Confirm the location.',
      })
    }
  }

  return flags
}

/**
 * Whether a TensorIQ pipeline line collides with Ber Wilson's own register.
 *
 * This is the commercially important one: under Section 4.4 Ber Wilson is the
 * exclusive general contractor on every Ber Wilson Project, so a TensorIQ line
 * describing a site already on the register either IS that project — in which
 * case Ber Wilson's role attaches to it — or is a different site that happens
 * to share a name, which needs saying out loud before anybody prices it.
 */
export function flagRegisterCollision(lineLabel: string): Flag[] {
  const text = lineLabel.toLowerCase()
  const flags: Flag[] = []

  for (const entry of PROJECT_REGISTER) {
    const hit = entry.aliases.find((a) => text.includes(a))
    if (!hit) continue
    flags.push({
      severity: 'question',
      code: 'register_collision',
      title: `"${lineLabel}" may be ${entry.name}, ${entry.state} on Ber Wilson's register`,
      detail: `It matches on "${hit}". If it is the same site, Ber Wilson's exclusive general contractor role under Section 4.4 already attaches and a Project Collaboration Agreement should cover it. If it is a different site, the register needs the second entry.`,
      resolution: `Confirm with TensorIQ whether this is ${entry.name}.`,
    })
  }

  for (const retired of RETIRED_CLAIMS) {
    if (!text.includes(retired)) continue
    flags.push({
      severity: 'question',
      code: 'retired_claim_active',
      title: `"${lineLabel}" is a retired entry still shown as active`,
      detail: `"${retired}" was retired on Ber Wilson's side but still appears in TensorIQ's materials. For Allentown specifically: Steelton is in Dauphin County, about 80 miles from Allentown in Lehigh County, so a 120 MW Allentown line is probably NOT Steelton — but it is close enough to need asking.`,
      resolution: 'Ask TensorIQ whether this is a live site and, if so, whether it is the same site as any register entry.',
    })
  }

  return flags
}

/** A project named in the brief's register with no record on the platform. */
export function flagMissingRegisterRecords(
  knownRecordNames: readonly string[]
): Flag[] {
  const known = knownRecordNames.map((n) => n.toLowerCase())
  return PROJECT_REGISTER.filter(
    (e) => e.active && !known.some((k) => e.aliases.some((a) => k.includes(a)))
  ).map((e) => ({
    severity: 'note' as FlagSeverity,
    code: 'register_entry_missing',
    title: `${e.name}, ${e.state} is on the register but has no record`,
    detail: `The brief lists ${e.name} among Ber Wilson's Project Register entries, but there is no project or opportunity on the platform matching it, so nothing can be sized or priced for it.`,
    resolution: `Create the record, or drop ${e.name} from the register if it is dead.`,
  }))
}

/** Claimed portfolio capacity against the pipeline it is supposedly built from. */
export function flagPortfolioReconciliation(
  claimedPortfolioMw: number,
  pipelineLowMw: number,
  pipelineHighMw: number
): Flag[] {
  if (claimedPortfolioMw <= pipelineHighMw * 1.5) return []
  const ratio = claimedPortfolioMw / pipelineHighMw
  return [
    {
      severity: 'question',
      code: 'portfolio_does_not_reconcile',
      title: `Claimed portfolio of ${claimedPortfolioMw.toLocaleString()} MW is ${ratio.toFixed(0)}x the tracked pipeline`,
      detail: `The same pipeline report states ${claimedPortfolioMw.toLocaleString()} MW of powered projects in the United States, and a tracked GPUaaS pipeline of ${pipelineLowMw}-${pipelineHighMw} MW across 16 opportunities. The two cannot both describe the same book of business.`,
      resolution:
        'Ask which figure is the pipeline. "Powered projects" may be counting sites where TensorIQ has no contractual position, in which case it is a market map rather than a pipeline.',
    },
  ]
}

/** An unlabeled confidence percentage must never become a probability. */
export function flagStatedConfidence(label: string, pct: number): Flag {
  return {
    severity: 'note',
    code: 'unlabeled_confidence',
    title: `"${label}" carries an unlabeled ${pct}%`,
    detail:
      'TensorIQ’s pipeline slides attach a bare percentage to each row with no definition. It is stored as "TensorIQ stated confidence, definition unconfirmed" and is not converted to a probability or used to weight any figure.',
    resolution: 'Ask what the percentage measures — probability of award, of close, or of deployment.',
  }
}

// ── Flags on our own computed figures. ──────────────────────────────────────

/** Fees over the 9.0% cap before adjustment, and the cap left untested. */
export function flagFeeResult(phase: PhaseFeeResult): Flag[] {
  const flags: Flag[] = []

  if (phase.capAmount == null) {
    flags.push({
      severity: 'blocker',
      code: 'cap_untested',
      title: `${phase.phaseLabel}: the ${AGGREGATE_FEE_CAP_PCT}% fee cap could not be tested`,
      detail:
        'No Total Project Cost for the phase, so Section 8.9 cannot be applied and the fees shown are not final. Scope D cannot be computed at all without it.',
      resolution: 'Get a cost estimate for the phase, which is also what the Role Protection Payment needs.',
    })
  } else if (phase.capApplied) {
    flags.push({
      severity: 'question',
      code: 'fee_cap_applied',
      title: `${phase.phaseLabel}: Schedule 1 fees exceed the ${AGGREGATE_FEE_CAP_PCT}% cap`,
      detail: `Gross Scope A-D fees of $${(phase.grossScopeFees / 1_000_000).toFixed(1)}M against a cap of $${(phase.capAmount / 1_000_000).toFixed(1)}M. The waterfall reduced Scope D first, then A, B and C proportionately.`,
      resolution:
        'Either accept the reduction, or seek the express agreement of both Parties and the Project Owner to a project-specific exception under Section 8.9.',
    })
  }

  // A fixed-price conversion with no settled allocation cannot proceed.
  const b = phase.scopes.find((s) => s.scope === 'B')
  if (b?.capExempt && phase.capApplied) {
    flags.push({
      severity: 'blocker',
      code: 'conversion_allocation_unsettled',
      title: `${phase.phaseLabel}: a converted Scope B cannot absorb a cap breach`,
      detail:
        'Section 8.9 forbids reducing a converted fixed-price Scope B fee after the lump sum is agreed, so the breach must be absorbed elsewhere or approved as an exception.',
      resolution:
        'Adopt the written fee allocation before conversion. Conversion does not occur without it.',
    })
  }

  return flags
}

/**
 * Whether the facility loading is thick enough to hold Ber Wilson's fees plus
 * insurance, bonds and contingency.
 *
 * On the 74 MW reference the 21.1% loading is $124.2M on $586M of direct cost,
 * against Schedule 1 fees of roughly $48M on the same scopes — leaving about
 * $76M for insurance, bonds and contingency on a $710M build. Thin, not absurd.
 */
export function flagFacilityLoading(
  directCost: number,
  loading: number,
  schedule1Fees: number
): Flag[] {
  const loadingDollars = directCost * (loading - 1)
  const remaining = loadingDollars - schedule1Fees
  const remainingPct = directCost > 0 ? (remaining / directCost) * 100 : 0

  if (remaining < 0) {
    return [
      {
        severity: 'blocker',
        code: 'loading_cannot_hold_fees',
        title: 'The facility loading cannot hold Ber Wilson’s fees at all',
        detail: `The ${((loading - 1) * 100).toFixed(1)}% loading is $${(loadingDollars / 1_000_000).toFixed(1)}M, against Schedule 1 fees of $${(schedule1Fees / 1_000_000).toFixed(1)}M on the same scopes. Insurance, bonds and contingency have nothing left.`,
        resolution: 'The facility cost per MW is understated. Re-price it before it reaches a proposal.',
      },
    ]
  }
  if (remainingPct < 8) {
    return [
      {
        severity: 'question',
        code: 'loading_thin',
        title: 'The facility loading is thin once fees are taken out',
        detail: `The ${((loading - 1) * 100).toFixed(1)}% loading leaves $${(remaining / 1_000_000).toFixed(1)}M (${remainingPct.toFixed(1)}% of direct cost) for insurance, bonds and contingency after $${(schedule1Fees / 1_000_000).toFixed(1)}M of Schedule 1 fees.`,
        resolution:
          'Confirm with TensorIQ what the 21.1% is meant to cover. If it excludes the contractor fee, the facility cost per MW needs to rise.',
      },
    ]
  }
  return []
}

/** The blanks in a Project Collaboration Agreement that block a real number. */
export interface PcaBlanks {
  acreage: boolean
  projectCompanyName: boolean
  tensorIqFundingAmount: boolean
  tensorIqFundingProof: boolean
  berWilsonEquity: boolean
  reservedCapacity: boolean
  deploymentMilestoneDates: boolean
  offtakeMilestoneDate: boolean
  powerAuthorizationDeadlines: boolean
  steeringCommitteeMembers: boolean
  phaseCapacities: boolean
  phaseCostEstimates: boolean
}

const PCA_BLANK_LABELS: Record<keyof PcaBlanks, { label: string; blocks: string }> = {
  acreage: { label: 'Site acreage', blocks: 'any land or site-work cost estimate' },
  projectCompanyName: { label: 'Project company name', blocks: 'the Project Owner on every Scope Agreement' },
  tensorIqFundingAmount: { label: 'TensorIQ funding amount', blocks: 'the pursuit budget and who carries predevelopment cost' },
  tensorIqFundingProof: { label: 'TensorIQ funding proof', blocks: 'reliance on that funding' },
  berWilsonEquity: { label: 'Ber Wilson equity or carried interest', blocks: 'any figure for what the deal is worth to Ber Wilson beyond fees' },
  reservedCapacity: { label: 'Reserved Capacity', blocks: "TensorIQ's own role protection under Section 9.9" },
  deploymentMilestoneDates: { label: 'Deployment Milestone dates', blocks: 'the release of uncommitted Reserved Capacity' },
  offtakeMilestoneDate: { label: 'Offtake milestone date', blocks: 'the anchor tenant condition the financing rests on' },
  powerAuthorizationDeadlines: { label: 'Power authorization deadlines', blocks: 'the Section 9.3(e) exclusion from role protection' },
  steeringCommitteeMembers: { label: 'Joint Steering Committee members', blocks: 'budget approval and expense authority' },
  phaseCapacities: { label: 'Per-phase Planned IT Capacity', blocks: 'per-phase fees, the per-phase cap, and the per-MW protection fallback' },
  phaseCostEstimates: { label: 'Per-phase cost estimates', blocks: 'every fee, the cap test, and any Stage 3 protection payment' },
}

export function flagPcaBlanks(projectName: string, blanks: PcaBlanks): Flag[] {
  const open = (Object.keys(blanks) as (keyof PcaBlanks)[]).filter((k) => blanks[k])
  if (open.length === 0) return []

  const critical: (keyof PcaBlanks)[] = ['phaseCapacities', 'phaseCostEstimates']
  const flags: Flag[] = []

  for (const key of open.filter((k) => critical.includes(k))) {
    flags.push({
      severity: 'blocker',
      code: `pca_blank_${key}`,
      title: `${projectName}: ${PCA_BLANK_LABELS[key].label} is blank in the PCA`,
      detail: `It blocks ${PCA_BLANK_LABELS[key].blocks}.`,
      resolution: 'Fill it in the Project Collaboration Agreement, or record the figure on the platform as an estimate marked as such.',
    })
  }

  const rest = open.filter((k) => !critical.includes(k))
  if (rest.length > 0) {
    flags.push({
      severity: 'question',
      code: 'pca_blanks_open',
      title: `${projectName}: ${rest.length} further Project Collaboration Agreement blanks`,
      detail: rest
        .map((k) => `${PCA_BLANK_LABELS[k].label} — blocks ${PCA_BLANK_LABELS[k].blocks}`)
        .join('; '),
      resolution: 'Work them through at the next Joint Steering Committee.',
    })
  }

  return flags
}

/** Order flags so a reader meets the blockers first. */
export function sortFlags(flags: readonly Flag[]): Flag[] {
  const rank: Record<FlagSeverity, number> = { blocker: 0, question: 1, note: 2 }
  return [...flags].sort((a, b) => rank[a.severity] - rank[b.severity])
}
