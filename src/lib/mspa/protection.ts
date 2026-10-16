/**
 * Part B — the Role Protection Payment: what Ber Wilson is owed if it is cut
 * out of a project it originated.
 *
 * Section 9.4 of the signed MSPA. Triggered when Ber Wilson is removed,
 * replaced or downgraded on a Ber Wilson Project, or the project is built or
 * contracted with someone else in Ber Wilson's role. Section 9.3 carries the
 * exclusions — Ber Wilson declining, its own uncured default, a lender
 * replacement, genuine abandonment — and those are a human's judgment, not
 * arithmetic, so this module computes the amount and never decides whether a
 * trigger occurred.
 *
 * ⚠ THE STAGE IS SET BY FACTS ABOUT THE PAPERWORK, NOT BY WHETHER AN ESTIMATE
 * EXISTS. Section 9.4: "The stage is determined by clauses (a) through (c),
 * not by the absence of an estimate." So `determineStage` reads site control
 * and signatures only, and the estimate question is handled separately.
 *
 * Pure arithmetic, sibling imports only. Safe for a verification script.
 */

import { AGGREGATE_FEE_CAP_PCT, type PhaseFeeInput, computePhaseFees } from './fees'

export type ProtectionStage = 1 | 2 | 3

export const STAGE_LABELS: Record<ProtectionStage, string> = {
  1: 'Presented',
  2: 'Secured',
  3: 'Contracted',
}

export const STAGE_PCT: Record<ProtectionStage, number> = {
  1: 10,
  2: 25,
  3: 40,
}

export const STAGE_CONDITIONS: Record<ProtectionStage, string> = {
  1: 'No site control, and no signed Project Collaboration Agreement or Project Owner acknowledgment',
  2: 'Ber Wilson holds site control, or a Project Collaboration Agreement or Project Owner acknowledgment is signed, but no Scope Agreement for the phase',
  3: 'A Scope Agreement for the phase is signed',
}

/** The no-reliable-estimate fallback, per MW of affected Planned IT Capacity. */
export const FALLBACK_PER_MW: Record<ProtectionStage, number | null> = {
  1: 50_000,
  2: 150_000,
  // ⚠ Stage 3 has no fallback at all: "A Stage 3 payment requires an estimate
  // developed under this paragraph." There is no per-MW escape at the top stage.
  3: null,
}

/** The cap on the whole event: 3.0% of the first $1B of TPC, 2.5% above. */
export const PROTECTION_CAP_TIERS = [
  { upTo: 1_000_000_000, ratePct: 3.0 },
  { upTo: null as number | null, ratePct: 2.5 },
] as const

/** The paperwork facts that set the stage. */
export interface StageFacts {
  /** Ber Wilson holds the Site Control Agreement (a PSA, option or deed). */
  holdsSiteControl: boolean
  /** A Project Collaboration Agreement or Project Owner acknowledgment is signed. */
  pcaOrAcknowledgmentSigned: boolean
  /** A Scope Agreement is signed FOR THIS PHASE. Per phase, never per project. */
  scopeAgreementSigned: boolean
}

/**
 * Which stage a phase sits at.
 *
 * ⚠ PER PHASE. A project with a signed PCA and a Scope Agreement on phase 1
 * only is Stage 3 on phase 1 and Stage 2 on every later phase — which is
 * exactly what the Steelton PCA states in its own words: "Because Ber Wilson
 * holds the Site Control Agreement, each phase is at Stage 2 (Secured) under
 * Section 9.4(b) until its Scope Agreement is signed."
 */
export function determineStage(facts: StageFacts): ProtectionStage {
  if (facts.scopeAgreementSigned) return 3
  if (facts.holdsSiteControl || facts.pcaOrAcknowledgmentSigned) return 2
  return 1
}

/** 3.0% of the first $1B of estimated TPC plus 2.5% of anything above. */
export function protectionCap(estimatedTpc: number): number {
  if (estimatedTpc <= 0) return 0
  const first = Math.min(estimatedTpc, 1_000_000_000)
  const above = Math.max(0, estimatedTpc - 1_000_000_000)
  return first * 0.03 + above * 0.025
}

export interface ProtectionInput {
  phaseLabel: string
  facts: StageFacts
  /**
   * The phase's fee inputs at the latest cost estimate, used to derive Unearned
   * Fees.
   *
   * ⚠ SCOPE B IS TAKEN AT THE EPCM RATE UNLESS IT HAS ALREADY BEEN CONVERTED.
   * Section 9.4. A project that merely *could* convert is valued at 7%, not
   * 12%, so this function forces `scopeBMode` to `epcm` unless the caller says
   * the conversion has actually happened.
   */
  fees: PhaseFeeInput | null
  /** True only where the fixed-price conversion has actually been executed. */
  scopeBAlreadyConverted: boolean
  /** Fees already earned and paid or payable. Subtracted to reach Unearned Fees. */
  feesAlreadyEarned: number
  /** Affected Planned IT Capacity, in IT MW. Only used by the fallback. */
  affectedItMw: number | null
  /** Estimated TPC for the affected phases, for the cap. Null = no estimate. */
  estimatedTpc: number | null
  /**
   * The power role protection amount from PCA item "Power role protection
   * amount (Section 9.4)".
   *
   * ⚠ BLANK MEANS ZERO, NOT "DERIVE ONE". The PCA says so in terms: "If blank,
   * no amount is implied." Steelton's is blank.
   */
  powerAmount: number | null
  /** Earned but unpaid fees — recoverable OUTSIDE the cap, with no duplication. */
  earnedUnpaidFees: number
  /** Documented unreimbursed Pursuit Costs — also outside the cap. */
  unreimbursedPursuitCosts: number
}

export interface ProtectionResult {
  phaseLabel: string
  stage: ProtectionStage
  stageLabel: string
  stagePct: number
  stageCondition: string
  /** Schedule 1 fees on the affected scopes, excluding preconstruction. */
  scheduleFees: number | null
  feesAlreadyEarned: number
  unearnedFees: number | null
  /** stagePct x unearnedFees, before the cap. */
  stageAmount: number | null
  /** True when the per-MW fallback was used because no estimate exists. */
  usedFallback: boolean
  fallbackPerMw: number | null
  powerAmount: number
  /** stageAmount + powerAmount, before the cap. */
  amountBeforeCap: number | null
  capAmount: number | null
  capApplied: boolean
  /** The payable Role Protection Payment. Null when it cannot be computed at all. */
  payable: number | null
  /** Recoverable in addition, outside the cap. */
  separatelyRecoverable: number
  /** Everything Ber Wilson would claim on this event. */
  totalClaim: number | null
  notes: string[]
  blockers: string[]
}

/**
 * The Role Protection Payment for one phase.
 *
 * The order is: reach Unearned Fees (or the per-MW fallback), apply the stage
 * percentage, add any agreed power amount, then cap the whole event. Earned
 * unpaid fees and Pursuit Costs are reported beside it and never inside it.
 */
export function computeRoleProtection(input: ProtectionInput): ProtectionResult {
  const notes: string[] = []
  const blockers: string[] = []
  const stage = determineStage(input.facts)
  const stagePct = STAGE_PCT[stage]

  // ── Schedule 1 fees on the affected scopes, at the EPCM rate for Scope B
  //    unless the conversion has actually happened.
  let scheduleFees: number | null = null
  if (input.fees) {
    const valuation = computePhaseFees({
      ...input.fees,
      scopeBMode: input.scopeBAlreadyConverted ? 'fixed_price' : 'epcm',
      // The conversion carve-out from the cap only bites once a lump sum is
      // agreed; a valuation for a removal event is not that moment.
      lumpSumAgreed: input.scopeBAlreadyConverted && input.fees.lumpSumAgreed,
    })
    // ⚠ EXCLUDING PRECONSTRUCTION AND UTILITY COORDINATION. The agreement's own
    // illustration derives Stage 1 of $7.6M from $76.0M, which is Scope A-D
    // only — $81.0M including preconstruction would give $8.1M and is wrong.
    scheduleFees = valuation.cappedScopeFees
    if (!input.scopeBAlreadyConverted && input.fees.scopeBMode === 'fixed_price') {
      notes.push(
        'Scope B is valued at the 7.0% EPCM rate, not 12.0%: Section 9.4 uses the EPCM rate unless the fixed-price conversion has already been executed.'
      )
    }
  }

  const unearnedFees =
    scheduleFees != null ? Math.max(0, scheduleFees - input.feesAlreadyEarned) : null

  // ── Stage amount, or the per-MW fallback where no estimate exists.
  let stageAmount: number | null = null
  let usedFallback = false
  const fallbackPerMw = FALLBACK_PER_MW[stage]

  if (unearnedFees != null) {
    stageAmount = unearnedFees * (stagePct / 100)
  } else if (fallbackPerMw != null && input.affectedItMw != null) {
    usedFallback = true
    stageAmount = input.affectedItMw * fallbackPerMw
    notes.push(
      `No reliable cost estimate, so Stage ${stage} falls back to $${fallbackPerMw.toLocaleString()} per MW of affected Planned IT Capacity (Section 9.4).`
    )
  } else if (stage === 3) {
    blockers.push(
      'Stage 3 has no per-MW fallback: "A Stage 3 payment requires an estimate developed under this paragraph." A cost estimate is required before any number can be given.'
    )
  } else if (input.affectedItMw == null) {
    blockers.push(
      'Neither a cost estimate nor an affected Planned IT Capacity figure, so no amount can be computed by either route.'
    )
  }

  const powerAmount = input.powerAmount ?? 0
  if (input.powerAmount == null) {
    notes.push(
      'No power role protection amount is stated in the Project Collaboration Agreement, so it is $0 — the PCA says "If blank, no amount is implied."'
    )
  }

  const amountBeforeCap = stageAmount != null ? stageAmount + powerAmount : null

  // ── The cap covers the WHOLE event, including the power amount.
  const capAmount = input.estimatedTpc != null ? protectionCap(input.estimatedTpc) : null
  let payable = amountBeforeCap
  let capApplied = false
  if (amountBeforeCap != null && capAmount != null && amountBeforeCap > capAmount) {
    payable = capAmount
    capApplied = true
  }

  if (capAmount == null && amountBeforeCap != null) {
    // ⚠ A REAL TENSION IN THE CONTRACT, NOT A GAP IN THIS CODE. The per-MW
    // fallback exists precisely because no estimate exists, yet the agreement
    // says that amount is "still subject to that cap" — and the cap is a
    // percentage of estimated TPC. With no estimate there is no cap to test, so
    // the figure below is uncapped and must be read as a ceiling-free maximum.
    notes.push(
      'No estimated Total Project Cost, so the 3.0% / 2.5% cap could not be applied. Section 9.4 subjects even the per-MW fallback to that cap, so this figure is an uncapped maximum and not a settled number.'
    )
  }

  const separatelyRecoverable = input.earnedUnpaidFees + input.unreimbursedPursuitCosts
  if (separatelyRecoverable > 0) {
    notes.push(
      'Earned but unpaid fees and documented unreimbursed Pursuit Costs are recoverable in addition and outside the cap, with no double recovery for the same scope.'
    )
  }

  return {
    phaseLabel: input.phaseLabel,
    stage,
    stageLabel: STAGE_LABELS[stage],
    stagePct,
    stageCondition: STAGE_CONDITIONS[stage],
    scheduleFees,
    feesAlreadyEarned: input.feesAlreadyEarned,
    unearnedFees,
    stageAmount,
    usedFallback,
    fallbackPerMw,
    powerAmount,
    amountBeforeCap,
    capAmount,
    capApplied,
    payable,
    separatelyRecoverable,
    totalClaim: payable != null ? payable + separatelyRecoverable : null,
    notes,
    blockers,
  }
}

/**
 * What Ber Wilson would owe TensorIQ if it caused TensorIQ's removal as
 * Technology Partner without cause (Section 9.9). Tracked as a LIABILITY.
 *
 * The PCA amount governs; where blank, the formula is 25% of TensorIQ's
 * projected net fees for its awarded services over the first 36 months,
 * excluding pass-through hardware, equipment and energy, and only on Reserved
 * Capacity where the Deployment Milestones were met.
 */
export const TENSORIQ_PROTECTION_PCT = 25
export const TENSORIQ_PROTECTION_MONTHS = 36

export interface TensorIqProtectionInput {
  /** The amount in the project agreement. Non-null wins outright. */
  statedAmount: number | null
  /**
   * TensorIQ's projected NET fees over 36 months for AWARDED services, already
   * excluding pass-through hardware, equipment and energy.
   */
  projectedNetFees36Months: number | null
  /** Whether the Deployment Milestones were met on the Reserved Capacity. */
  deploymentMilestonesMet: boolean
}

export interface TensorIqProtectionResult {
  amount: number | null
  basis: 'stated_in_pca' | 'formula' | 'none'
  notes: string[]
}

export function computeTensorIqProtection(
  input: TensorIqProtectionInput
): TensorIqProtectionResult {
  if (input.statedAmount != null) {
    return {
      amount: input.statedAmount,
      basis: 'stated_in_pca',
      notes: ['The amount is stated in the Project Collaboration Agreement and governs.'],
    }
  }
  if (!input.deploymentMilestonesMet) {
    return {
      amount: 0,
      basis: 'none',
      notes: [
        'The Deployment Milestones were not met on the Reserved Capacity, so no amount is payable under Section 9.9.',
      ],
    }
  }
  if (input.projectedNetFees36Months == null) {
    return {
      amount: null,
      basis: 'formula',
      notes: [
        'The Section 9.9 formula applies but TensorIQ’s projected net fees for its awarded services over the first 36 months are not known, so no amount can be computed.',
      ],
    }
  }
  return {
    amount: input.projectedNetFees36Months * (TENSORIQ_PROTECTION_PCT / 100),
    basis: 'formula',
    notes: [
      `25% of TensorIQ’s projected net fees over the first 36 months, excluding pass-through hardware, equipment and energy.`,
    ],
  }
}

/** Re-exported so a caller does not have to reach into `fees` for the cap figure. */
export { AGGREGATE_FEE_CAP_PCT }
