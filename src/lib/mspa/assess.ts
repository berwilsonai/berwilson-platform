/**
 * The one entry point: assess an opportunity under the TensorIQ MSPA.
 *
 * ⚠ THE SHAPE OF THE RESULT ENFORCES PART E'S PRESENTATION RULE. Ber Wilson's
 * fees and protection are contractual and come back as single exact figures;
 * TensorIQ's project returns are modelled and come back ONLY as a scenario
 * array. There is no field on this result that holds a single expected MOIC,
 * because there is no honest way to render one.
 *
 * ⚠ AND EVERY ASSUMPTION IS NAMED. `assumptions` carries one entry per default
 * the engine had to supply, so a screen can mark it rather than absorb it, and
 * `missing` names the input that would replace it.
 *
 * Pure, sibling imports only. Safe for a verification script.
 */

import {
  type CoolingType,
  type MwBasis,
  PUE_BY_COOLING,
  resolveCapacity,
  type ResolvedCapacity,
} from './capacity'
import {
  computePhaseFees,
  type PhaseFeeInput,
  type PhaseFeeResult,
  type ScopeBMode,
  type ScopeKey,
} from './fees'
import {
  flagCapacityClaim,
  flagFacilityLoading,
  flagFeeResult,
  flagPcaBlanks,
  flagRegisterCollision,
  type Flag,
  type PcaBlanks,
  sortFlags,
} from './flags'
import {
  computeRoleProtection,
  type ProtectionResult,
  type StageFacts,
} from './protection'
import {
  computeReturns,
  rateSensitivity,
  type ReturnsResult,
} from './returns'
import {
  computeFacilityCost,
  type FacilityCost,
  type GpuGeneration,
  sizeDeployment,
  type DeploymentSizing,
} from './sizing'

/** A default the engine supplied because nobody stated the real figure. */
export interface Assumption {
  field: string
  value: string
  source: string
}

/** An input whose absence changes the answer. */
export interface MissingInput {
  field: string
  blocks: string
}

export interface PhaseSpec {
  label: string
  /** Planned IT Capacity for the phase, in MW on the project's basis. */
  mw: number | null
  /** Cost of the Work by scope, where a real estimate exists. */
  costA?: number | null
  costB?: number | null
  costC?: number | null
  tpc?: number | null
  /** Per-phase stage facts. A Scope Agreement is signed per phase. */
  scopeAgreementSigned: boolean
}

export interface OpportunitySpec {
  name: string
  state: string | null
  /** The MW figure as stated, and its basis. Null basis is a blocker. */
  statedMw: number | null
  mwBasis: MwBasis | null
  cooling: CoolingType
  pue?: number | null
  gpuGeneration?: GpuGeneration | null
  gpuCount?: number | null
  phases: readonly PhaseSpec[]
  /** Which scopes Ber Wilson holds. */
  scopesHeld: readonly ScopeKey[]
  scopeBMode: ScopeBMode
  lumpSumAgreed: boolean
  /** Site control and signatures, which set the protection stage. */
  siteControl: boolean
  pcaSigned: boolean
  /** Owner payments to the utility for utility-built work. */
  utilityBuiltWorkCost?: number | null
  /** The PCA's power role protection amount. Null means blank, which means zero. */
  powerProtectionAmount?: number | null
  pcaBlanks?: PcaBlanks | null
  feeAdjustments?: string | null
  /**
   * True when this spec came from Ber Wilson's own Project Register.
   *
   * ⚠ THE REGISTER-COLLISION FLAG IS FOR A COUNTERPARTY'S LABEL, NOT FOR OURS.
   * Run against our own record it fires on itself — "Steelton may be Steelton"
   * — which is noise that trains a reader to ignore the flag list.
   */
  isOwnRecord?: boolean
}

export interface PhaseAssessment {
  label: string
  capacity: ResolvedCapacity | null
  /** Null when no estimate and no model could produce a cost. */
  facility: FacilityCost | null
  /** True when the cost base came from the TensorIQ model, not an estimate. */
  costsAreModelled: boolean
  fees: PhaseFeeResult
  protection: ProtectionResult
}

export interface Assessment {
  name: string
  // ── Ber Wilson's number: contractual, exact.
  phases: PhaseAssessment[]
  totalFees: number
  totalScopeFees: number
  totalPreconstruction: number
  totalUtilityCoordination: number
  /** The protection payment at today's stage, summed across phases. */
  totalProtectionAtCurrentStage: number | null
  // ── The project estimate: modelled, scenarios only.
  sizing: DeploymentSizing | null
  returns: ReturnsResult[] | null
  sensitivity: ReturnType<typeof rateSensitivity> | null
  // ── Everything that is not a number.
  capacity: ResolvedCapacity | null
  bothReadings: { asIt: number; asUtility: number } | null
  flags: Flag[]
  assumptions: Assumption[]
  missing: MissingInput[]
}

/**
 * Assess one opportunity.
 *
 * The order is deliberate and matches Part E: capacity first (because the unit
 * trap poisons everything), then Ber Wilson's fees and protection, then the
 * modelled project estimate, then the flags.
 */
export function assessOpportunity(spec: OpportunitySpec): Assessment {
  const flags: Flag[] = []
  const assumptions: Assumption[] = []
  const missing: MissingInput[] = []

  // ── 1. Capacity, and the unit trap. ───────────────────────────────────────
  if (spec.statedMw == null) {
    missing.push({
      field: 'Planned IT Capacity (MW)',
      blocks: 'every figure below — there is no capacity to size, price or protect',
    })
  } else {
    flags.push(
      ...flagCapacityClaim({
        label: spec.name,
        statedValue: spec.statedMw,
        statedUnit: 'MW',
        basis: spec.mwBasis,
        state: spec.state,
      })
    )
  }
  if (!spec.isOwnRecord) flags.push(...flagRegisterCollision(spec.name))

  const pue = spec.pue ?? PUE_BY_COOLING[spec.cooling]
  if (spec.pue == null) {
    assumptions.push({
      field: 'PUE',
      value: pue.toFixed(2),
      source: `TensorIQ model default for ${spec.cooling === 'dlc' ? 'DLC' : 'immersion'} cooling`,
    })
  }

  // ⚠ WHERE THE BASIS IS UNSTATED, THE CAPACITY IS COMPUTED BOTH WAYS AND
  // NEITHER IS ADOPTED. Picking one silently is the single most expensive
  // mistake available here, so the result carries both and the flag stands.
  const capacity =
    spec.statedMw != null && spec.mwBasis != null
      ? resolveCapacity({ mw: spec.statedMw, basis: spec.mwBasis }, spec.cooling, spec.pue)
      : null

  const bothReadings =
    spec.statedMw != null && spec.mwBasis == null
      ? { asIt: spec.statedMw * pue, asUtility: spec.statedMw / pue }
      : null

  // ⚠ THE PHASES MUST NOT ADD UP TO MORE THAN THE PROJECT. A phase list is
  // easy to seed from a roadmap whose figures are CUMULATIVE rather than
  // incremental, or on the other load basis entirely — Steelton's grid roadmap
  // reads 300 / 500 / 700 MW, which as increments would be 1,500 MW against a
  // Planned IT Capacity of 900. Nothing else in the chain notices.
  const phaseSum = spec.phases.reduce((sum, p) => sum + (p.mw ?? 0), 0)
  if (spec.statedMw != null && phaseSum > spec.statedMw * 1.001 && spec.phases.length > 1) {
    flags.push({
      severity: 'blocker',
      code: 'phases_exceed_project',
      title: `${spec.name}: the phases add up to more than the project`,
      detail: `The phase capacities total ${phaseSum.toLocaleString()} MW against a stated project capacity of ${spec.statedMw.toLocaleString()} MW. Either the phase figures are cumulative rather than incremental, or they are on a different load basis, or the project figure is wrong.`,
      resolution:
        'Confirm whether the phase figures are increments or running totals. If they are cumulative, enter the differences.',
    })
  }

  // ── 2. Sizing, where a GPU count exists. ─────────────────────────────────
  let sizing: DeploymentSizing | null = null
  if (spec.gpuGeneration && spec.gpuCount != null) {
    sizing = sizeDeployment({
      gpuGeneration: spec.gpuGeneration,
      cooling: spec.cooling,
      gpuCount: spec.gpuCount,
      pue: spec.pue,
    })
  } else if (spec.gpuGeneration == null) {
    missing.push({
      field: 'GPU generation and count',
      blocks: 'hardware cost and GPUaaS revenue — the facility can still be priced from MW alone',
    })
  }

  // ── 3. Per phase: fees and protection. ───────────────────────────────────
  const holds = (s: ScopeKey) => spec.scopesHeld.includes(s)
  const phaseAssessments: PhaseAssessment[] = []

  for (const phase of spec.phases) {
    const phaseCapacity =
      phase.mw != null && spec.mwBasis != null
        ? resolveCapacity({ mw: phase.mw, basis: spec.mwBasis }, spec.cooling, spec.pue)
        : null

    // Where there is no cost estimate, fall back to the TensorIQ facility model
    // and MARK the whole cost base as modelled.
    let facility: FacilityCost | null = null
    let costsAreModelled = false
    let costA = phase.costA ?? null
    let costB = phase.costB ?? null
    let costC = phase.costC ?? null
    let tpc = phase.tpc ?? null

    const haveRealCosts = costA != null || costB != null || costC != null || tpc != null

    if (!haveRealCosts && phaseCapacity) {
      facility = computeFacilityCost(phaseCapacity, spec.cooling)
      costsAreModelled = true
      costA = holds('A') ? facility.byScope.A : null
      costB = holds('B') ? facility.byScope.B : null
      costC = holds('C') ? facility.byScope.C : null
      // ⚠ TPC IS TAKEN AS THE SUM OF THE SCOPES AND NOTHING MORE. It excludes
      // land, GPUs, financing and utility payments by Section 8.6, and the
      // model gives us no soft-cost line, so this understates a real TPC.
      tpc = facility.loadedTotal
      assumptions.push({
        field: `${phase.label} Cost of the Work`,
        value: `$${(facility.loadedTotal / 1_000_000).toFixed(1)}M from the TensorIQ facility model at $${(facility.loadedPerUtilityMw / 1_000_000).toFixed(1)}M per utility MW`,
        source:
          'TLH_74MW_14OCT2026 rates. No project cost estimate exists, so every fee below is modelled.',
      })
      assumptions.push({
        field: `${phase.label} Total Project Cost`,
        value: 'Taken as the facility cost, with no soft-cost line',
        source:
          'The model provides no soft costs, so TPC is understated and the Scope D fee and the 9.0% cap with it.',
      })
      missing.push({
        field: `${phase.label} cost estimate`,
        blocks: 'an exact fee, the cap test, and any Stage 3 protection payment',
      })
    } else if (!haveRealCosts && !phaseCapacity) {
      missing.push({
        field: `${phase.label} capacity or cost estimate`,
        blocks: 'any fee at all for this phase',
      })
    }

    const feeInput: PhaseFeeInput = {
      phaseLabel: phase.label,
      costA,
      costB,
      costC,
      tpc,
      performsDevelopmentManagement: holds('D'),
      scopeBMode: spec.scopeBMode,
      lumpSumAgreed: spec.lumpSumAgreed,
      utilityBuiltWorkCost: spec.utilityBuiltWorkCost ?? null,
      preconstructionScopes: (['A', 'B', 'C'] as ScopeKey[]).filter(holds),
    }
    const fees = computePhaseFees(feeInput)
    flags.push(...flagFeeResult(fees))

    if (facility) {
      flags.push(
        ...flagFacilityLoading(facility.directTotal, facility.loading, fees.cappedScopeFees)
      )
    }

    const facts: StageFacts = {
      holdsSiteControl: spec.siteControl,
      pcaOrAcknowledgmentSigned: spec.pcaSigned,
      scopeAgreementSigned: phase.scopeAgreementSigned,
    }

    // ⚠ A MODELLED COST BASE IS NOT A "RELIABLE COST ESTIMATE" FOR SECTION 9.4.
    // Where the costs came from the model rather than an estimate, protection
    // goes down the per-MW fallback route, which is what the contract intends.
    const protection = computeRoleProtection({
      phaseLabel: phase.label,
      facts,
      fees: costsAreModelled ? null : feeInput,
      scopeBAlreadyConverted: spec.scopeBMode === 'fixed_price' && spec.lumpSumAgreed,
      feesAlreadyEarned: 0,
      affectedItMw: phaseCapacity?.itMw ?? null,
      estimatedTpc: costsAreModelled ? null : tpc,
      powerAmount: spec.powerProtectionAmount ?? null,
      earnedUnpaidFees: 0,
      unreimbursedPursuitCosts: 0,
    })

    phaseAssessments.push({
      label: phase.label,
      capacity: phaseCapacity,
      facility,
      costsAreModelled,
      fees,
      protection,
    })
  }

  // ── 4. Returns, as scenarios only. ───────────────────────────────────────
  let returns: ReturnsResult[] | null = null
  let sensitivity: ReturnType<typeof rateSensitivity> | null = null
  if (sizing && capacity) {
    const facility = computeFacilityCost(capacity, spec.cooling)
    const operating = {
      utilityMw: capacity.utilityMw,
      gpuCount: sizing.gpuCount,
      hardwareCost: sizing.hardwareCost,
      facilityCost: facility.loadedTotal,
    }
    returns = computeReturns(operating)
    sensitivity = rateSensitivity(operating)
  }

  // ── 5. The paperwork. ────────────────────────────────────────────────────
  if (spec.pcaBlanks) flags.push(...flagPcaBlanks(spec.name, spec.pcaBlanks))
  if (spec.powerProtectionAmount == null) {
    assumptions.push({
      field: 'Power role protection amount',
      value: '$0',
      source: 'Blank in the PCA, which states that no amount is implied.',
    })
  }

  const protectionFigures = phaseAssessments
    .map((p) => p.protection.payable)
    .filter((v): v is number => v != null)

  return {
    name: spec.name,
    phases: phaseAssessments,
    totalFees: phaseAssessments.reduce((s, p) => s + p.fees.totalFees, 0),
    totalScopeFees: phaseAssessments.reduce((s, p) => s + p.fees.cappedScopeFees, 0),
    totalPreconstruction: phaseAssessments.reduce((s, p) => s + p.fees.preconstructionFee, 0),
    totalUtilityCoordination: phaseAssessments.reduce(
      (s, p) => s + p.fees.utilityCoordinationFee,
      0
    ),
    totalProtectionAtCurrentStage:
      protectionFigures.length === phaseAssessments.length && protectionFigures.length > 0
        ? protectionFigures.reduce((s, v) => s + v, 0)
        : null,
    sizing,
    returns,
    sensitivity,
    capacity,
    bothReadings,
    flags: sortFlags(flags),
    assumptions,
    missing,
  }
}
