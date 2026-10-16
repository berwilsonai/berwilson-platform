/**
 * Part A — Ber Wilson's fees under Schedule 1 of the Master Strategic
 * Partnership Agreement with TensorIQ.
 *
 * ⚠ THIS HALF IS CONTRACTUAL AND IS COMPUTED EXACTLY. Everything in
 * `returns.ts` is a modelled estimate shown as scenarios; nothing here is.
 * The rates, tiers, cap and waterfall below were read off the SIGNED
 * agreement (`BerWilson_TensorIQ_Master_Strategic_Partnership_Agreement_v6.5`,
 * Schedule 1 and Sections 8.5, 8.7, 8.9, 8.12), not off a deck, and the
 * agreement's own $1.0B fee illustration is asserted in `fees.test.ts`. If a
 * number here changes, that test fails, which is the point.
 *
 * ⚠ PERCENTAGE TIERS ARE MARGINAL, NOT CLIFF RATES. Schedule 1: "Percentage
 * tiers are progressive marginal tiers: each rate applies only to the portion
 * of the stated fee base within its band, not to the entire base." Reading
 * them as cliff rates overstates Scope A on a $700M base by $5.0M.
 *
 * Pure arithmetic, sibling imports only. Safe for a verification script.
 */

/** A marginal band: `ratePct` applies to the base between the previous bound and `upTo`. */
export interface FeeTier {
  /** Upper bound of this band in dollars, or null for "everything above". */
  upTo: number | null
  ratePct: number
}

export type ScopeKey = 'A' | 'B' | 'C' | 'D'

export const SCOPE_KEYS: readonly ScopeKey[] = ['A', 'B', 'C', 'D']

export const SCOPE_LABELS: Record<ScopeKey, string> = {
  A: 'Data center facilities',
  B: 'Power generation and grid',
  C: 'Land development and site work',
  D: 'Development management',
}

/** What each scope's fee is charged on, for printing beside the number. */
export const SCOPE_FEE_BASE_LABELS: Record<ScopeKey, string> = {
  A: 'Cost of the Work, data center scope',
  B: 'Cost of the Work, power and grid scope',
  C: 'Cost of the Work, land and site scope',
  D: 'Total Project Cost for the phase',
}

export const SCOPE_A_TIERS: readonly FeeTier[] = [
  { upTo: 500_000_000, ratePct: 4.0 },
  { upTo: 2_000_000_000, ratePct: 3.0 },
  { upTo: null, ratePct: 2.5 },
]

/** Scope B is a single rate, not a tier set. EPCM is the default. */
export const SCOPE_B_EPCM_PCT = 7.0
export const SCOPE_B_FIXED_PRICE_PCT = 12.0

export const SCOPE_C_TIERS: readonly FeeTier[] = [
  { upTo: 100_000_000, ratePct: 6.0 },
  { upTo: null, ratePct: 4.0 },
]

export const SCOPE_D_TIERS: readonly FeeTier[] = [
  { upTo: 1_000_000_000, ratePct: 3.0 },
  { upTo: 3_000_000_000, ratePct: 2.0 },
  { upTo: null, ratePct: 1.5 },
]

/** Section 8.7 — managing the owner's interface with a utility-built network upgrade. */
export const UTILITY_COORDINATION_PCT = 1.5

/** Section 8.12 — Scopes A, B and C only. Scope D earns no preconstruction fee. */
export const PRECONSTRUCTION_PCT = 0.5
export const PRECONSTRUCTION_SCOPES: readonly ScopeKey[] = ['A', 'B', 'C']

/** Section 8.9 — Scopes A through D in a phase, as a share of that phase's TPC. */
export const AGGREGATE_FEE_CAP_PCT = 9.0

/**
 * The milestone split preconstruction is paid on (Section 8.12). Carried so a
 * cash-flow view can place the money; it does not change the total.
 */
export const PRECONSTRUCTION_MILESTONES: readonly { label: string; sharePct: number }[] = [
  { label: 'Construction document review', sharePct: 40 },
  { label: 'GMP or EPC price proposal', sharePct: 40 },
  { label: 'GMP acceptance or EPCM notice to proceed', sharePct: 20 },
]

/**
 * Apply a marginal tier set to a base.
 *
 * Each rate touches only the slice of `base` inside its band. A base of zero
 * returns zero; a negative base throws, because a negative Cost of the Work is
 * not a discount, it is a data error.
 */
export function applyTiers(base: number, tiers: readonly FeeTier[]): number {
  if (!Number.isFinite(base)) throw new Error(`Fee base must be finite; got ${base}`)
  if (base < 0) throw new Error(`Fee base cannot be negative; got ${base}`)
  let fee = 0
  let floor = 0
  for (const tier of tiers) {
    const ceiling = tier.upTo ?? Infinity
    if (base <= floor) break
    const slice = Math.min(base, ceiling) - floor
    if (slice > 0) fee += slice * (tier.ratePct / 100)
    floor = ceiling
  }
  return fee
}

/** The per-band breakdown, so a screen can show the math rather than the total. */
export interface TierBreakdown {
  ratePct: number
  from: number
  to: number | null
  sliceBase: number
  fee: number
}

export function tierBreakdown(base: number, tiers: readonly FeeTier[]): TierBreakdown[] {
  const rows: TierBreakdown[] = []
  let floor = 0
  for (const tier of tiers) {
    const ceiling = tier.upTo ?? Infinity
    const slice = Math.max(0, Math.min(base, ceiling) - floor)
    if (slice > 0) {
      rows.push({
        ratePct: tier.ratePct,
        from: floor,
        to: tier.upTo,
        sliceBase: slice,
        fee: slice * (tier.ratePct / 100),
      })
    }
    floor = ceiling
    if (base <= floor) break
  }
  return rows
}

/** How Scope B is being delivered. Drives its rate and whether the cap may cut it. */
export type ScopeBMode = 'epcm' | 'fixed_price'

export const SCOPE_B_MODE_LABELS: Record<ScopeBMode, string> = {
  epcm: 'EPCM (cost-reimbursable, default)',
  fixed_price: 'Converted to fixed-price EPC (Section 8.5)',
}

/** One phase of one project: the costs the fees are charged on. */
export interface PhaseFeeInput {
  phaseLabel: string
  /** Cost of the Work, data center scope. Null = scope not engaged. */
  costA: number | null
  /** Cost of the Work, power and grid scope. */
  costB: number | null
  /** Cost of the Work, land and site scope. */
  costC: number | null
  /**
   * Total Project Cost for the phase — hard plus soft costs.
   *
   * ⚠ EXCLUDES, per Section 8.6 and the Schedule 1 footnote: the land purchase
   * price; Ber Wilson's own fees; GPUs, servers, network, storage and any
   * compute or IT equipment whoever supplies it; interest during construction,
   * financing fees and reserves; and payments to a utility for utility-built
   * work including any refundable deposit or collateral. GPUs never enter a
   * fee base — on the 74 MW reference case that is $3.26B of hardware against
   * $710M of facility, so including it would roughly quintuple every fee.
   */
  tpc: number | null
  /** True only where Ber Wilson actually performs development management. */
  performsDevelopmentManagement: boolean
  scopeBMode: ScopeBMode
  /**
   * Whether the lump sum has already been agreed. Once it has, a converted
   * Scope B fee may not be reduced by the cap waterfall (Section 8.9).
   */
  lumpSumAgreed: boolean
  /** Owner payments to the utility for utility-built work. Outside TPC and outside the cap. */
  utilityBuiltWorkCost: number | null
  /** Which scopes have an engaged preconstruction phase. Defaults to those with a cost. */
  preconstructionScopes?: readonly ScopeKey[] | null
}

export interface ScopeFeeResult {
  scope: ScopeKey
  label: string
  base: number
  baseLabel: string
  /** The fee Schedule 1 produces before the aggregate cap is applied. */
  grossFee: number
  /** The fee after the Section 8.9 waterfall. Equal to `grossFee` when the cap does not bite. */
  fee: number
  /** How much the cap took off this scope. */
  capReduction: number
  tiers: TierBreakdown[]
  /** Set where the rate is flat rather than tiered. */
  flatRatePct: number | null
  /** True when the cap may not touch this fee. */
  capExempt: boolean
}

export interface PhaseFeeResult {
  phaseLabel: string
  scopes: ScopeFeeResult[]
  /** 0.5% of estimated Cost of the Work for each engaged scope among A, B, C. */
  preconstructionFee: number
  preconstructionBase: number
  preconstructionScopes: ScopeKey[]
  /** 1.5% of owner payments to the utility for utility-built work. */
  utilityCoordinationFee: number
  /** Scopes A-D after the cap. The quantity the 9.0% test is applied to. */
  cappedScopeFees: number
  /** Scopes A-D before the cap. */
  grossScopeFees: number
  /** Everything Ber Wilson invoices for this phase. */
  totalFees: number
  tpc: number | null
  /** 9.0% of TPC, or null when TPC is unknown and the cap cannot be tested. */
  capAmount: number | null
  /** True when gross Scope A-D fees exceeded the cap and the waterfall ran. */
  capApplied: boolean
  /** Scope A-D fees as a share of TPC, after the cap. */
  effectiveScopePctOfTpc: number | null
  /** All fees including preconstruction as a share of TPC. Can exceed 9% legitimately. */
  totalPctOfTpc: number | null
  notes: string[]
}

/**
 * Fees for one phase, with the Section 8.9 waterfall applied.
 *
 * The waterfall, in the agreement's own order: any excess "first reduces the
 * Scope D fee to zero, then reduces fees for Scopes A, B under EPCM, and C
 * proportionately to their otherwise applicable amounts." A converted
 * fixed-price Scope B is held out of the reduction once the lump sum is agreed.
 *
 * ⚠ WITH NO TPC THERE IS NO CAP TEST AT ALL, and the result says so in `notes`
 * rather than quietly reporting uncapped fees as final.
 */
export function computePhaseFees(input: PhaseFeeInput): PhaseFeeResult {
  const notes: string[] = []
  const scopes: ScopeFeeResult[] = []

  const bRatePct = input.scopeBMode === 'epcm' ? SCOPE_B_EPCM_PCT : SCOPE_B_FIXED_PRICE_PCT
  const bCapExempt = input.scopeBMode === 'fixed_price' && input.lumpSumAgreed

  if (input.costA != null) {
    scopes.push({
      scope: 'A',
      label: SCOPE_LABELS.A,
      base: input.costA,
      baseLabel: SCOPE_FEE_BASE_LABELS.A,
      grossFee: applyTiers(input.costA, SCOPE_A_TIERS),
      fee: applyTiers(input.costA, SCOPE_A_TIERS),
      capReduction: 0,
      tiers: tierBreakdown(input.costA, SCOPE_A_TIERS),
      flatRatePct: null,
      capExempt: false,
    })
  }

  if (input.costB != null) {
    const fee = input.costB * (bRatePct / 100)
    scopes.push({
      scope: 'B',
      label: SCOPE_LABELS.B,
      base: input.costB,
      baseLabel:
        input.scopeBMode === 'fixed_price'
          ? 'Included in lump-sum price'
          : SCOPE_FEE_BASE_LABELS.B,
      grossFee: fee,
      fee,
      capReduction: 0,
      tiers: [],
      flatRatePct: bRatePct,
      capExempt: bCapExempt,
    })
    if (bCapExempt) {
      notes.push(
        'Scope B is a converted fixed-price EPC with the lump sum agreed, so the cap waterfall may not reduce it (Section 8.9). The fee allocation had to be settled before conversion.'
      )
    }
  }

  if (input.costC != null) {
    scopes.push({
      scope: 'C',
      label: SCOPE_LABELS.C,
      base: input.costC,
      baseLabel: SCOPE_FEE_BASE_LABELS.C,
      grossFee: applyTiers(input.costC, SCOPE_C_TIERS),
      fee: applyTiers(input.costC, SCOPE_C_TIERS),
      capReduction: 0,
      tiers: tierBreakdown(input.costC, SCOPE_C_TIERS),
      flatRatePct: null,
      capExempt: false,
    })
  }

  if (input.performsDevelopmentManagement && input.tpc != null) {
    scopes.push({
      scope: 'D',
      label: SCOPE_LABELS.D,
      base: input.tpc,
      baseLabel: SCOPE_FEE_BASE_LABELS.D,
      grossFee: applyTiers(input.tpc, SCOPE_D_TIERS),
      fee: applyTiers(input.tpc, SCOPE_D_TIERS),
      capReduction: 0,
      tiers: tierBreakdown(input.tpc, SCOPE_D_TIERS),
      flatRatePct: null,
      capExempt: false,
    })
  } else if (input.performsDevelopmentManagement && input.tpc == null) {
    notes.push(
      'Ber Wilson performs development management but no Total Project Cost is stated, so the Scope D fee cannot be calculated. It is the largest single fee in the reference illustration ($30.0M of $81.0M).'
    )
  }

  // ── Preconstruction: 0.5% of estimated Cost of the Work for each engaged scope.
  //
  // ⚠ THE BASE IS COST OF THE WORK, NOT TPC, AND THE AGREEMENT'S OWN
  // ILLUSTRATION HIDES THE DIFFERENCE. There A+B+C = $700M + $200M + $100M =
  // $1,000M, which happens to equal TPC exactly, so both readings give $5.0M
  // and the illustration cannot tell them apart. On any real phase where soft
  // costs sit inside TPC, or land is excluded from it, the two diverge.
  const engaged = (input.preconstructionScopes ?? PRECONSTRUCTION_SCOPES).filter((s) =>
    PRECONSTRUCTION_SCOPES.includes(s)
  )
  const costByScope: Record<'A' | 'B' | 'C', number | null> = {
    A: input.costA,
    B: input.costB,
    C: input.costC,
  }
  const preconScopes = engaged.filter(
    (s) => s !== 'D' && costByScope[s as 'A' | 'B' | 'C'] != null
  ) as ScopeKey[]
  const preconstructionBase = preconScopes.reduce(
    (sum, s) => sum + (costByScope[s as 'A' | 'B' | 'C'] ?? 0),
    0
  )
  const preconstructionFee = preconstructionBase * (PRECONSTRUCTION_PCT / 100)

  const utilityCoordinationFee =
    input.utilityBuiltWorkCost != null
      ? input.utilityBuiltWorkCost * (UTILITY_COORDINATION_PCT / 100)
      : 0

  // ── Section 8.9 waterfall.
  const grossScopeFees = scopes.reduce((sum, s) => sum + s.grossFee, 0)
  const capAmount = input.tpc != null ? input.tpc * (AGGREGATE_FEE_CAP_PCT / 100) : null
  let capApplied = false

  if (capAmount != null && grossScopeFees > capAmount) {
    capApplied = true
    let excess = grossScopeFees - capAmount

    // 1. Scope D to zero first.
    const d = scopes.find((s) => s.scope === 'D')
    if (d && excess > 0) {
      const cut = Math.min(d.fee, excess)
      d.fee -= cut
      d.capReduction = cut
      excess -= cut
    }

    // 2. Then A, B-under-EPCM and C proportionately to their otherwise
    //    applicable amounts. A converted B with an agreed lump sum is held out.
    if (excess > 0) {
      const reducible = scopes.filter((s) => s.scope !== 'D' && !s.capExempt)
      const pool = reducible.reduce((sum, s) => sum + s.grossFee, 0)
      if (pool > 0) {
        for (const s of reducible) {
          const cut = excess * (s.grossFee / pool)
          s.fee -= cut
          s.capReduction += cut
        }
        excess = 0
      } else {
        notes.push(
          'The 9.0% cap is exceeded but every remaining fee is cap-exempt, so the excess cannot be reduced. The fee allocation needs the Project Owner’s express agreement under Section 8.9.'
        )
      }
    }
  }

  const cappedScopeFees = scopes.reduce((sum, s) => sum + s.fee, 0)
  const totalFees = cappedScopeFees + preconstructionFee + utilityCoordinationFee

  if (capAmount == null) {
    notes.push(
      'No Total Project Cost for this phase, so the 9.0% Aggregate Fee Cap could not be tested and these fees are not final.'
    )
  }

  return {
    phaseLabel: input.phaseLabel,
    scopes,
    preconstructionFee,
    preconstructionBase,
    preconstructionScopes: preconScopes,
    utilityCoordinationFee,
    cappedScopeFees,
    grossScopeFees,
    totalFees,
    tpc: input.tpc,
    capAmount,
    capApplied,
    effectiveScopePctOfTpc: input.tpc ? (cappedScopeFees / input.tpc) * 100 : null,
    totalPctOfTpc: input.tpc ? (totalFees / input.tpc) * 100 : null,
    notes,
  }
}

/**
 * Fees across every phase of a project.
 *
 * ⚠ PHASES ARE NEVER COMBINED TO CLIMB A TIER OR SPLIT TO AVOID ONE. Schedule
 * 1: the base "may not be artificially divided to alter the fee", and each
 * phase gets its own TPC, tiers and cap. So this sums per-phase results and
 * never re-tiers the total — tiering $2B as one base instead of two $1B phases
 * changes Scope D by $10M.
 */
export interface ProjectFeeResult {
  phases: PhaseFeeResult[]
  totalFees: number
  totalScopeFees: number
  totalPreconstruction: number
  totalUtilityCoordination: number
  totalTpc: number | null
}

export function computeProjectFees(phases: readonly PhaseFeeInput[]): ProjectFeeResult {
  const results = phases.map(computePhaseFees)
  const knownTpc = results.filter((r) => r.tpc != null)
  return {
    phases: results,
    totalFees: results.reduce((s, r) => s + r.totalFees, 0),
    totalScopeFees: results.reduce((s, r) => s + r.cappedScopeFees, 0),
    totalPreconstruction: results.reduce((s, r) => s + r.preconstructionFee, 0),
    totalUtilityCoordination: results.reduce((s, r) => s + r.utilityCoordinationFee, 0),
    totalTpc:
      knownTpc.length === results.length && results.length > 0
        ? knownTpc.reduce((s, r) => s + (r.tpc ?? 0), 0)
        : null,
  }
}
