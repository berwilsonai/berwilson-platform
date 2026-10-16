/**
 * Sizing is held to the real tearsheet.
 *
 * `TLH_74MW_14OCT2026`, sent by Sterling Orr (TensorIQ CFO) on 2026-10-15,
 * publishes every intermediate figure for a 27,072-GPU GB300 DLC deployment.
 * If our arithmetic cannot reproduce their own printed numbers, we cannot
 * sanity-check anything they present, so these assertions are the licence to
 * use this module at all.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bothReadings, resolveCapacity } from './capacity'
import {
  computeFacilityCost,
  FACILITY_LOADING,
  gpuCountForEqualCompute,
  sizeDeployment,
} from './sizing'

const M = 1_000_000
const B = 1_000_000_000

/** Within `pctTol` percent of the published figure. */
const close = (actual: number, published: number, pctTol: number, what: string) => {
  const drift = Math.abs(actual - published) / Math.abs(published)
  assert.ok(
    drift <= pctTol / 100,
    `${what}: tearsheet says ${published.toLocaleString()}, we get ${actual.toLocaleString()} (${(drift * 100).toFixed(3)}% off)`
  )
}

const TLH = {
  gpuCount: 27_072,
  servers: 3384,
  itMw: 52.9,
  utilityMw: 74.0,
  overhead: 1.47,
  sqft: 177_688,
  availableGpuHoursPerUtilityMwYear: 3_203_145,
  hardware: 3.26 * B,
  perGpu: 120_000,
  perItMw: 61.6 * M,
  perUtilityMw: 44.0 * M,
  facilityDirect: 586 * M,
  facilityLoaded: 710.3 * M,
  // The scope split published in the brief, derived from the same lines.
  scopeA: 392.7 * M,
  scopeB: 268.8 * M,
  scopeC: 48.4 * M,
}

test('TLH_74MW_14OCT2026: derived sizing reproduces the tearsheet', () => {
  const s = sizeDeployment({ gpuGeneration: 'gb300', cooling: 'dlc', gpuCount: TLH.gpuCount })

  assert.equal(s.servers, TLH.servers, 'servers at 8 GPU each')
  close(s.effectiveOverhead, TLH.overhead, 0.5, 'IT power overhead (1.25 x 1.175)')
  close(s.capacity.itMw, TLH.itMw, 0.2, 'IT power')
  close(s.capacity.utilityMw, TLH.utilityMw, 0.2, 'utility power')
  close(s.floorSqft, TLH.sqft, 0.2, 'floor area')
  close(
    s.availableGpuHoursPerUtilityMwYear,
    TLH.availableGpuHoursPerUtilityMwYear,
    0.2,
    'available GPU-hours per utility MW-year'
  )
})

test('TLH_74MW_14OCT2026: hardware cost reproduces the tearsheet', () => {
  const s = sizeDeployment({ gpuGeneration: 'gb300', cooling: 'dlc', gpuCount: TLH.gpuCount })

  close(s.hardwareCost, TLH.hardware, 0.5, 'hardware acquisition')
  close(s.hardwareCostPerGpu, TLH.perGpu, 1, 'cost per GPU')
  close(s.hardwareCostPerItMw, TLH.perItMw, 0.5, 'IT infra spend per IT MW')
  close(s.hardwareCostPerUtilityMw, TLH.perUtilityMw, 0.5, 'per utility MW')

  // The model's own admission about the infra multiplier must surface.
  assert.ok(
    s.caveats.some((c) => c.includes('bill of materials')),
    'the infra-multiplier placeholder caveat must be raised'
  )
  // $61.6M/IT MW is above the $30-50M rule of thumb, and that must be said.
  assert.ok(
    s.caveats.some((c) => c.includes('rule of thumb')),
    'a per-MW figure above the industry band must be flagged'
  )
})

test('TLH_74MW_14OCT2026: facility cost reproduces the tearsheet', () => {
  const s = sizeDeployment({ gpuGeneration: 'gb300', cooling: 'dlc', gpuCount: TLH.gpuCount })
  const f = computeFacilityCost(s.capacity, 'dlc')

  close(f.directTotal, TLH.facilityDirect, 0.5, 'direct facility cost')
  close(f.loadedTotal, TLH.facilityLoaded, 0.5, 'loaded facility cost')
  close(f.loadedPerUtilityMw, 9.6 * M, 1, 'loaded cost per utility MW')
  assert.equal(f.loading, FACILITY_LOADING)

  // The scope split, which is what becomes a Schedule 1 fee base.
  close(f.byScope.A, TLH.scopeA, 0.5, 'Scope A slice')
  close(f.byScope.B, TLH.scopeB, 0.5, 'Scope B slice')
  close(f.byScope.C, TLH.scopeC, 0.5, 'Scope C slice')

  // The three scopes must account for the whole facility, with nothing lost.
  close(
    f.byScope.A + f.byScope.B + f.byScope.C,
    f.loadedTotal,
    0.001,
    'scopes sum to the facility cost'
  )

  // The scope mapping is an assumption and must say so.
  assert.ok(f.caveats.some((c) => c.includes('assumption')))
})

test('the unit trap: one MW figure, two readings that differ by half', () => {
  const { asIt, asUtility } = bothReadings(900, 'dlc')
  // 900 IT MW at PUE 1.4 is 1,260 utility MW.
  close(asIt.utilityMw, 1260, 0.001, '900 read as IT load')
  // 900 utility MW at PUE 1.4 is about 643 IT MW.
  close(asUtility.itMw, 642.857, 0.01, '900 read as utility load')
  // Which is the whole point: the readings are not close.
  assert.ok(asIt.itMw / asUtility.itMw > 1.39)

  // Immersion at PUE 1.2: 900 utility MW is 750 IT MW.
  const immersion = bothReadings(900, 'immersion')
  close(immersion.asUtility.itMw, 750, 0.001, '900 utility MW at PUE 1.2')
  close(immersion.asIt.utilityMw, 1080, 0.001, '900 IT MW at PUE 1.2')
})

test('a PUE below 1.0 is impossible and throws rather than returning a number', () => {
  assert.throws(() => resolveCapacity({ mw: 100, basis: 'it' }, 'dlc', 0.9), /at least 1/)
  assert.throws(() => resolveCapacity({ mw: -1, basis: 'it' }, 'dlc'), /non-negative/)
})

test('immersion needs more GPUs for the same compute and less floor', () => {
  // Compute scales by 1 / cooling clock: DLC derates to 0.95, immersion does not.
  close(gpuCountForEqualCompute(27_072, 'dlc'), 28_497, 0.1, 'DLC needs more parts')
  assert.equal(gpuCountForEqualCompute(27_072, 'immersion'), 27_072)

  const dlc = sizeDeployment({ gpuGeneration: 'gb300', cooling: 'dlc', gpuCount: 27_072 })
  const imm = sizeDeployment({ gpuGeneration: 'gb300', cooling: 'immersion', gpuCount: 27_072 })
  // Immersion draws full TDP, so more IT MW, but at PUE 1.2 less utility MW.
  assert.ok(imm.capacity.itMw > dlc.capacity.itMw, 'no clock derate')
  assert.ok(imm.capacity.utilityMw < dlc.capacity.utilityMw, 'better PUE wins overall')
  // And immersion is far denser: 1,250 sqft per MW against 2,400.
  assert.ok(imm.floorSqft < dlc.floorSqft / 1.8)
})

test('a facility cost can be built straight from a MW figure with no GPU count', () => {
  const { capacity, facility } = computeFromMw()
  close(capacity.utilityMw, 74.0, 0.1, 'utility MW')
  close(facility.loadedTotal, TLH.facilityLoaded, 1, 'the same facility cost')

  function computeFromMw() {
    const cap = resolveCapacity({ mw: 74.0, basis: 'utility' }, 'dlc')
    return { capacity: cap, facility: computeFacilityCost(cap, 'dlc') }
  }
})

test('zero GPUs produces zeroes rather than NaN', () => {
  const s = sizeDeployment({ gpuGeneration: 'gb300', cooling: 'dlc', gpuCount: 0 })
  assert.equal(s.capacity.itMw, 0)
  assert.equal(s.hardwareCostPerGpu, 0)
  assert.equal(s.availableGpuHoursPerUtilityMwYear, 0)
  assert.throws(() => sizeDeployment({ gpuGeneration: 'gb300', cooling: 'dlc', gpuCount: -5 }))
})
