/**
 * The assessment's inputs, carried in the query string.
 *
 * ⚠ STATE IN THE URL, NOT IN COMPONENT STATE. A fee figure quoted on a call has
 * to be a link that reproduces it exactly, and a filter kept only in component
 * state is not a view (CLAUDE.md §12). Every input below round-trips.
 *
 * Pure, sibling imports only.
 */

import type { CoolingType, MwBasis } from './capacity'
import type { ScopeBMode, ScopeKey } from './fees'
import { MSPA_REGISTER, type RegisterRecord } from './register'
import type { GpuGeneration } from './sizing'
import { GPU_SPECS } from './sizing'
import type { OpportunitySpec, PhaseSpec } from './assess'

export type Flat = Record<string, string | undefined>

function num(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function bool(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[]
): T | null {
  return value != null && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

const BASES: readonly MwBasis[] = ['it', 'utility']
const COOLINGS: readonly CoolingType[] = ['dlc', 'immersion']
const B_MODES: readonly ScopeBMode[] = ['epcm', 'fixed_price']
const SCOPES: readonly ScopeKey[] = ['A', 'B', 'C', 'D']

/** The record a `?record=` names, matched exactly on its name. */
export function recordFromParams(params: Flat): RegisterRecord | null {
  const name = params.record
  if (!name) return null
  return MSPA_REGISTER.find((r) => r.name === name) ?? null
}

/**
 * Build an assessment spec from the query string, seeded from a register record
 * where one is named.
 *
 * ⚠ THE REGISTER SEEDS, THE URL OVERRIDES, AND THE BASIS IS NEVER INVENTED. If
 * neither the register nor the URL says which load a MW figure measures, the
 * spec carries a null basis and the assessment refuses to resolve it.
 */
export function specFromParams(params: Flat): OpportunitySpec {
  const record = recordFromParams(params)

  const statedMw = num(params.mw) ?? record?.statedMw ?? null
  const mwBasis = oneOf(params.basis, BASES) ?? record?.mwBasis ?? null
  const cooling = oneOf(params.cooling, COOLINGS) ?? 'dlc'

  const scopesParam = params.scopes
  const scopesHeld: ScopeKey[] =
    scopesParam != null
      ? SCOPES.filter((s) => scopesParam.toUpperCase().includes(s))
      : record && record.scopesHeld.length > 0
        ? [...record.scopesHeld]
        : ['A', 'B', 'C', 'D']

  // Phases: `phases=300,500,700` as per-phase MW, or one phase of the whole.
  const phaseMw = (params.phases ?? '')
    .split(',')
    .map((p) => num(p))
    .filter((n): n is number => n != null)

  const scopeSigned = (params.signed ?? '')
    .split(',')
    .map((s) => s.trim())

  const phases: PhaseSpec[] =
    phaseMw.length > 0
      ? phaseMw.map((mw, i) => ({
          label: `Phase ${i + 1}`,
          mw,
          costA: num(params[`p${i + 1}a`]),
          costB: num(params[`p${i + 1}b`]),
          costC: num(params[`p${i + 1}c`]),
          tpc: num(params[`p${i + 1}tpc`]),
          scopeAgreementSigned: scopeSigned.includes(String(i + 1)),
        }))
      : [
          {
            label: 'Whole project',
            mw: statedMw,
            costA: num(params.costa),
            costB: num(params.costb),
            costC: num(params.costc),
            tpc: num(params.tpc),
            scopeAgreementSigned: bool(params.scopeagreement),
          },
        ]

  return {
    name: record?.name ?? params.name ?? 'Unnamed opportunity',
    state: record?.state ?? params.state ?? null,
    statedMw,
    mwBasis,
    cooling,
    pue: num(params.pue),
    gpuGeneration: oneOf(
      params.gpu,
      Object.keys(GPU_SPECS) as GpuGeneration[]
    ),
    gpuCount: num(params.gpus),
    phases,
    scopesHeld,
    scopeBMode: oneOf(params.bmode, B_MODES) ?? 'epcm',
    lumpSumAgreed: bool(params.lumpsum),
    siteControl: params.sitecontrol != null ? bool(params.sitecontrol) : (record?.siteControl ?? false),
    pcaSigned: params.pca != null ? bool(params.pca) : (record?.pcaSigned ?? false),
    utilityBuiltWorkCost: num(params.utilitywork),
    powerProtectionAmount: num(params.powerprotection) ?? record?.powerProtectionAmount ?? null,
    pcaBlanks:
      record?.pcaSigned && record.name.startsWith('Steelton')
        ? {
            // ⚠ READ OFF THE SIGNED PCA, EVERY ONE OF THEM STILL BLANK.
            acreage: true,
            projectCompanyName: true,
            tensorIqFundingAmount: true,
            tensorIqFundingProof: true,
            berWilsonEquity: true,
            reservedCapacity: true,
            deploymentMilestoneDates: true,
            offtakeMilestoneDate: true,
            powerAuthorizationDeadlines: true,
            steeringCommitteeMembers: true,
            phaseCapacities: true,
            phaseCostEstimates: true,
          }
        : null,
    feeAdjustments: record?.pcaSigned ? 'None — Schedule 1 tiered fees apply' : null,
    isOwnRecord: record != null,
  }
}

/** The query string for a spec, so a result can be linked. */
export function paramsFromSpec(spec: OpportunitySpec): string {
  const p = new URLSearchParams()
  if (spec.name !== 'Unnamed opportunity') p.set('record', spec.name)
  if (spec.statedMw != null) p.set('mw', String(spec.statedMw))
  if (spec.mwBasis) p.set('basis', spec.mwBasis)
  if (spec.cooling !== 'dlc') p.set('cooling', spec.cooling)
  if (spec.gpuGeneration) p.set('gpu', spec.gpuGeneration)
  if (spec.gpuCount != null) p.set('gpus', String(spec.gpuCount))
  if (spec.scopesHeld.length !== 4) p.set('scopes', spec.scopesHeld.join(''))
  if (spec.scopeBMode !== 'epcm') p.set('bmode', spec.scopeBMode)
  const phaseMw = spec.phases.map((x) => x.mw).filter((m): m is number => m != null)
  if (spec.phases.length > 1 && phaseMw.length === spec.phases.length) {
    p.set('phases', phaseMw.join(','))
  }
  return p.toString()
}

/** Default export, for the same reason as `assess.ts` — see the note there. */
const paramsModule = { specFromParams, paramsFromSpec, recordFromParams }

export default paramsModule
