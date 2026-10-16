/**
 * Part D1-D3 — TensorIQ's own project model ("Infra-Matic"), reimplemented so
 * an opportunity they present can be sized and sanity-checked.
 *
 * ⚠ EVERYTHING IN THIS MODULE IS A MODELLED ESTIMATE, NOT A CONTRACTUAL
 * NUMBER. `fees.ts` and `protection.ts` compute what Ber Wilson is OWED and are
 * exact; this computes what a deal might COST and is a scenario. The two must
 * never be presented at the same confidence.
 *
 * The constants are TensorIQ's, read off the `TLH_74MW_14OCT2026` tearsheet
 * Sterling Orr sent on 2026-10-15, and `sizing.test.ts` reproduces that
 * tearsheet's published figures. They are their assumptions, carried here so
 * our arithmetic can be compared against theirs — not endorsed.
 *
 * Pure arithmetic, sibling imports only. Safe for a verification script.
 */

import {
  COOLING_CLOCK,
  type CoolingType,
  floorAreaSqft,
  PUE_BY_COOLING,
  resolveCapacity,
  type ResolvedCapacity,
} from './capacity'

export type GpuGeneration =
  | 'rtx_pro_6000'
  | 'h100'
  | 'h200'
  | 'b200'
  | 'b300'
  | 'gb300'
  | 'rubin_sxm'

export interface GpuSpec {
  label: string
  /** Dense BF16 TFLOPs, for compute-equivalent comparisons. */
  denseBf16Tflops: number
  tdpWatts: number
  /**
   * Non-GPU power ratio: the share of rack power that is not the GPU itself.
   * Multiplied by the scenario scalar to reach effective overhead.
   */
  nonGpuRatio: number
  /** List price for a server of 8 GPUs. */
  serverPrice8Gpu: number
}

export const GPU_SPECS: Record<GpuGeneration, GpuSpec> = {
  rtx_pro_6000: {
    label: 'RTX Pro 6000',
    denseBf16Tflops: 500,
    tdpWatts: 600,
    nonGpuRatio: 1.1,
    serverPrice8Gpu: 200_000,
  },
  h100: {
    label: 'H100',
    denseBf16Tflops: 990,
    tdpWatts: 700,
    nonGpuRatio: 1.15,
    serverPrice8Gpu: 350_000,
  },
  h200: {
    label: 'H200',
    denseBf16Tflops: 990,
    tdpWatts: 700,
    nonGpuRatio: 1.15,
    serverPrice8Gpu: 350_000,
  },
  b200: {
    label: 'B200',
    denseBf16Tflops: 2250,
    tdpWatts: 1000,
    nonGpuRatio: 1.2,
    serverPrice8Gpu: 600_000,
  },
  b300: {
    label: 'B300',
    denseBf16Tflops: 2250,
    tdpWatts: 1100,
    nonGpuRatio: 1.2,
    serverPrice8Gpu: 650_000,
  },
  gb300: {
    label: 'GB300',
    denseBf16Tflops: 2500,
    tdpWatts: 1400,
    nonGpuRatio: 1.25,
    serverPrice8Gpu: 770_000,
  },
  rubin_sxm: {
    label: 'Rubin SXM',
    denseBf16Tflops: 4000,
    tdpWatts: 2300,
    nonGpuRatio: 1.25,
    serverPrice8Gpu: 900_000,
  },
}

export const GPUS_PER_SERVER = 8

/** The workload scenario scalar on the non-GPU ratio. The model's default. */
export const DEFAULT_SCENARIO_SCALAR = 1.175

/**
 * The infra multiplier on total server cost: fabric, storage and integration.
 *
 * ⚠ IT SCALES THE WHOLE SERVER PRICE, WHICH OVERCHARGES FABRIC ON NEWER CHIPS.
 * The tearsheet admits this in its own words: the same fabric is charged "2.80x
 * more on an R200 than a B200 and 7.78x more than on an A100". Any hardware
 * figure built on it is a placeholder until priced by bill of materials, and
 * `sizeDeployment` says so in `caveats`.
 */
export const DEFAULT_INFRA_MULTIPLIER = 1.25

// ── Facility cost rates, per the Cooling & Facility tab. ─────────────────────

/** Cooling plant, per IT MW. */
export const COOLING_PLANT_PER_IT_MW: Record<CoolingType, number> = {
  dlc: 350_000,
  immersion: 500_000,
}

/** IT electrical, per IT MW. */
export const ELECTRICAL_IT_PER_IT_MW = 2_500_000
/** Cooling electrical, per COOLING MW (utility MW less IT MW). */
export const COOLING_ELECTRICAL_PER_COOLING_MW = 2_958_000
/** Generators and substation, per utility MW. This is the Scope B slice. */
export const GENERATORS_SUBSTATION_PER_UTILITY_MW = 3_000_000
/** Site, civil and interconnection, per utility MW. The Scope C slice. */
export const SITE_CIVIL_PER_UTILITY_MW = 541_000
/** MEPC engineering, per utility MW. */
export const MEPC_ENGINEERING_PER_UTILITY_MW = 500_000
/** Shell, per gross square foot. */
export const SHELL_PER_SQFT = 417

/**
 * Indirects, fee and contingency on direct facility cost: 21.1%.
 *
 * ⚠ THIS SINGLE LINE HAS TO HOLD BER WILSON'S FEES PLUS INSURANCE, BONDS AND
 * CONTINGENCY. On the 74 MW reference that is $124.2M of loading against
 * Schedule 1 fees of roughly $48M on the same scopes — leaving about $76M for
 * everything else. `flags.ts` tests whether it is thin enough to matter.
 */
export const FACILITY_LOADING = 1.211

export interface DeploymentInput {
  gpuGeneration: GpuGeneration
  cooling: CoolingType
  gpuCount: number
  /** Defaults to the model's 1.175. */
  scenarioScalar?: number | null
  /** Defaults to the model's 1.25. */
  infraMultiplier?: number | null
  /** Defaults to the cooling type's PUE. */
  pue?: number | null
}

export interface DeploymentSizing {
  gpu: GpuSpec
  gpuCount: number
  servers: number
  /** nonGpuRatio x scenarioScalar. */
  effectiveOverhead: number
  coolingClock: number
  capacity: ResolvedCapacity
  floorSqft: number
  /** Available GPU-hours per utility MW-year, the GPUaaS denominator. */
  availableGpuHoursPerUtilityMwYear: number
  hardwareCost: number
  hardwareCostPerGpu: number
  hardwareCostPerItMw: number
  hardwareCostPerUtilityMw: number
  caveats: string[]
}

export const HOURS_PER_YEAR = 8760

/**
 * Size a deployment from a fixed GPU count — the tearsheet's "reverse mode".
 *
 * IT MW = GPUs x TDP x cooling clock x effective overhead / 1,000,000. The
 * clock derate applies to POWER because a thermally limited part draws less
 * than its TDP; to reach the same COMPUTE the GPU count scales by 1 / clock
 * (see `gpuCountForEqualCompute`).
 */
export function sizeDeployment(input: DeploymentInput): DeploymentSizing {
  const gpu = GPU_SPECS[input.gpuGeneration]
  if (!gpu) throw new Error(`Unknown GPU generation: ${input.gpuGeneration}`)
  if (!Number.isFinite(input.gpuCount) || input.gpuCount < 0) {
    throw new Error(`GPU count must be a non-negative number; got ${input.gpuCount}`)
  }

  const scenarioScalar = input.scenarioScalar ?? DEFAULT_SCENARIO_SCALAR
  const infraMultiplier = input.infraMultiplier ?? DEFAULT_INFRA_MULTIPLIER
  const effectiveOverhead = gpu.nonGpuRatio * scenarioScalar
  const coolingClock = COOLING_CLOCK[input.cooling]

  const servers = input.gpuCount / GPUS_PER_SERVER
  const itMw =
    (input.gpuCount * gpu.tdpWatts * coolingClock * effectiveOverhead) / 1_000_000

  const capacity = resolveCapacity({ mw: itMw, basis: 'it' }, input.cooling, input.pue)
  const floorSqft = floorAreaSqft(capacity.utilityMw, input.cooling)

  const hardwareCost = servers * gpu.serverPrice8Gpu * infraMultiplier

  const caveats: string[] = []
  if (infraMultiplier !== 1) {
    caveats.push(
      `Hardware cost uses the model's x${infraMultiplier} infra multiplier on the FULL server price, which charges $${Math.round(
        (gpu.serverPrice8Gpu * (infraMultiplier - 1)) / GPUS_PER_SERVER
      ).toLocaleString()} per GPU of fabric, storage and integration. Because it scales total server cost, newer parts are overcharged for the same fabric. Placeholder until priced by bill of materials.`
    )
  }
  const perItMw = itMw > 0 ? hardwareCost / itMw : 0
  if (perItMw > 50_000_000) {
    caveats.push(
      `IT infrastructure spend is $${(perItMw / 1_000_000).toFixed(1)}M per IT MW, above the $30M-$50M per IT MW industry rule of thumb (unverified, label as such).`
    )
  }

  return {
    gpu,
    gpuCount: input.gpuCount,
    servers,
    effectiveOverhead,
    coolingClock,
    capacity,
    floorSqft,
    availableGpuHoursPerUtilityMwYear:
      capacity.utilityMw > 0 ? (input.gpuCount / capacity.utilityMw) * HOURS_PER_YEAR : 0,
    hardwareCost,
    hardwareCostPerGpu: input.gpuCount > 0 ? hardwareCost / input.gpuCount : 0,
    hardwareCostPerItMw: perItMw,
    hardwareCostPerUtilityMw:
      capacity.utilityMw > 0 ? hardwareCost / capacity.utilityMw : 0,
    caveats,
  }
}

/**
 * The GPU count needed to match a reference deployment's compute under a
 * different cooling architecture. Compute scales by 1 / cooling clock.
 */
export function gpuCountForEqualCompute(gpuCount: number, cooling: CoolingType): number {
  return gpuCount / COOLING_CLOCK[cooling]
}

// ── D3: the facility, which is where Ber Wilson actually works. ──────────────

export interface FacilityCostLine {
  key: string
  label: string
  /** Which Schedule 1 scope this line is assumed to fall in. */
  scope: 'A' | 'B' | 'C'
  basis: string
  directCost: number
}

export interface FacilityCost {
  lines: FacilityCostLine[]
  directTotal: number
  loading: number
  /** Direct x loading. The all-in facility cost. */
  loadedTotal: number
  loadedPerUtilityMw: number
  /** Loaded cost grouped by assumed Schedule 1 scope — the fee base estimate. */
  byScope: { A: number; B: number; C: number }
  caveats: string[]
}

/**
 * Facility cost from a resolved capacity.
 *
 * ⚠ THE SCOPE MAPPING IS AN ASSUMPTION AND IS FLAGGED AS ONE. Nothing in the
 * MSPA or the tearsheet maps these cost lines onto Schedule 1 scopes; the split
 * below (A = shell, cooling plant, electrical, MEPC; B = generators and
 * substation; C = site, civil and interconnection) is this platform's reading,
 * used to ESTIMATE a fee before a real cost estimate exists. A signed Scope
 * Agreement's own cost breakdown always supersedes it.
 */
export function computeFacilityCost(
  capacity: ResolvedCapacity,
  cooling: CoolingType,
  options: { loading?: number | null } = {}
): FacilityCost {
  const { itMw, utilityMw, coolingMw } = capacity
  const sqft = floorAreaSqft(utilityMw, cooling)
  const loading = options.loading ?? FACILITY_LOADING

  const lines: FacilityCostLine[] = [
    {
      key: 'cooling_plant',
      label: 'Cooling plant',
      scope: 'A',
      basis: `$${COOLING_PLANT_PER_IT_MW[cooling].toLocaleString()} per IT MW x ${itMw.toFixed(1)} IT MW`,
      directCost: COOLING_PLANT_PER_IT_MW[cooling] * itMw,
    },
    {
      key: 'electrical_it',
      label: 'IT electrical',
      scope: 'A',
      basis: `$2.5M per IT MW x ${itMw.toFixed(1)} IT MW`,
      directCost: ELECTRICAL_IT_PER_IT_MW * itMw,
    },
    {
      key: 'cooling_electrical',
      label: 'Cooling electrical',
      scope: 'A',
      basis: `$2.958M per cooling MW x ${coolingMw.toFixed(1)} cooling MW`,
      directCost: COOLING_ELECTRICAL_PER_COOLING_MW * coolingMw,
    },
    {
      key: 'mepc_engineering',
      label: 'MEPC engineering',
      scope: 'A',
      basis: `$0.5M per utility MW x ${utilityMw.toFixed(1)} utility MW`,
      directCost: MEPC_ENGINEERING_PER_UTILITY_MW * utilityMw,
    },
    {
      key: 'shell',
      label: 'Shell',
      scope: 'A',
      basis: `$${SHELL_PER_SQFT} per sqft x ${Math.round(sqft).toLocaleString()} sqft`,
      directCost: SHELL_PER_SQFT * sqft,
    },
    {
      key: 'generators_substation',
      label: 'Generators and substation',
      scope: 'B',
      basis: `$3.0M per utility MW x ${utilityMw.toFixed(1)} utility MW`,
      directCost: GENERATORS_SUBSTATION_PER_UTILITY_MW * utilityMw,
    },
    {
      key: 'site_civil',
      label: 'Site, civil and interconnection',
      scope: 'C',
      basis: `$0.541M per utility MW x ${utilityMw.toFixed(1)} utility MW`,
      directCost: SITE_CIVIL_PER_UTILITY_MW * utilityMw,
    },
  ]

  const directTotal = lines.reduce((s, l) => s + l.directCost, 0)
  const loadedTotal = directTotal * loading

  const byScope = { A: 0, B: 0, C: 0 }
  for (const line of lines) byScope[line.scope] += line.directCost * loading

  const caveats = [
    'The mapping of these cost lines onto Schedule 1 Scopes A, B and C is this platform’s assumption, not a term of the MSPA or the TensorIQ model. A signed Scope Agreement’s own cost breakdown supersedes it.',
    `The ${((loading - 1) * 100).toFixed(1)}% loading is one line covering indirects, fee and contingency — it has to hold Ber Wilson’s Schedule 1 fees plus insurance, bonds and contingency together.`,
  ]

  return {
    lines,
    directTotal,
    loading,
    loadedTotal,
    loadedPerUtilityMw: utilityMw > 0 ? loadedTotal / utilityMw : 0,
    byScope,
    caveats,
  }
}

/** Facility cost straight from a megawatt figure, for an opportunity with no GPU count. */
export function facilityCostFromMw(
  mw: number,
  basis: 'it' | 'utility',
  cooling: CoolingType,
  options: { pue?: number | null; loading?: number | null } = {}
): { capacity: ResolvedCapacity; facility: FacilityCost } {
  const capacity = resolveCapacity({ mw, basis }, cooling, options.pue)
  return { capacity, facility: computeFacilityCost(capacity, cooling, options) }
}

export { PUE_BY_COOLING }
