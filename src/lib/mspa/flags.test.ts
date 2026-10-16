/**
 * The flags are asserted against the actual claims in TensorIQ's own materials,
 * because a flag that does not fire on the real document is decoration.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computePhaseFees } from './fees'
import {
  flagCapacityClaim,
  flagFacilityLoading,
  flagMissingRegisterRecords,
  flagFeeResult,
  flagPcaBlanks,
  flagPortfolioReconciliation,
  flagRegisterCollision,
  PROJECT_REGISTER,
  sortFlags,
} from './flags'

const M = 1_000_000

const codes = (f: { code: string }[]) => f.map((x) => x.code)

test('a bare MW figure is a blocker until its basis is stated', () => {
  const unstated = flagCapacityClaim({
    label: 'Steelton',
    statedValue: 900,
    statedUnit: 'MW',
    basis: null,
  })
  assert.ok(codes(unstated).includes('mw_basis_unconfirmed'))
  assert.equal(unstated[0].severity, 'blocker')

  // Stated, so no flag.
  const stated = flagCapacityClaim({
    label: 'Steelton',
    statedValue: 900,
    statedUnit: 'MW',
    basis: 'it',
  })
  assert.equal(codes(stated).length, 0)
})

test('the real "Western, WV – 800 GW" line fires both a unit and a register flag', () => {
  const unit = flagCapacityClaim({
    label: 'Western, WV',
    statedValue: 800,
    statedUnit: 'GW',
    basis: null,
    state: 'WV',
  })
  assert.ok(codes(unit).includes('gigawatt_suspect'), '800 GW must be caught')
  assert.ok(unit.some((f) => f.detail.includes('800,000 MW')))
  assert.ok(unit.some((f) => f.severity === 'blocker'))

  // And "Western, WV" collides with Weirton on the register.
  const collision = flagRegisterCollision('Western, WV – 800 GW')
  assert.ok(codes(collision).includes('register_collision'))
  assert.ok(collision.some((f) => f.title.includes('Weirton')))
})

test('the real "Newport, AK" and "Calgary, CA" lines are caught as place errors', () => {
  const newport = flagCapacityClaim({
    label: 'Newport',
    statedValue: 140,
    statedUnit: 'MW',
    basis: 'utility',
    state: 'AK',
  })
  assert.ok(codes(newport).includes('place_state_mismatch'))
  assert.ok(newport.some((f) => f.resolution.includes('Newport, AR')))

  const calgary = flagCapacityClaim({
    label: 'Calgary',
    statedValue: 2000,
    statedUnit: 'MW',
    basis: null,
    state: 'CA',
  })
  assert.ok(codes(calgary).includes('place_state_mismatch'))
  assert.ok(calgary.some((f) => f.resolution.includes('Calgary, AB')))
})

test('Chicago and Allentown are caught as retired claims still shown active', () => {
  const chicago = flagRegisterCollision('Chicago, IL')
  // Chicago is BOTH a retired claim and an alias of Riverdale, Cook County.
  assert.ok(codes(chicago).includes('retired_claim_active'))
  assert.ok(
    chicago.some((f) => f.title.includes('Riverdale')),
    'Riverdale IS Cook County, so a Chicago line is probably the same site'
  )

  const allentown = flagRegisterCollision('Allentown, PA – 120 MW')
  assert.ok(codes(allentown).includes('retired_claim_active'))
  // And the flag must carry the geography, not just the suspicion.
  assert.ok(allentown.some((f) => f.detail.includes('Dauphin')))
  assert.ok(allentown.some((f) => f.detail.includes('80 miles')))
})

test('Eagle Mountain is on the register with no record to compute against', () => {
  const onPlatform = [
    'Steelton — Cleveland-Cliffs (PA)',
    'Weirton — Cleveland-Cliffs (WV)',
    'Riverdale — Cleveland-Cliffs (IL)',
    'Myton Development',
    'Delta Industrial Campus — Daves Farms',
    'Heber Development',
  ]
  const missing = flagMissingRegisterRecords(onPlatform)
  assert.equal(missing.length, 1, 'exactly one register entry has no record')
  assert.ok(missing[0].title.includes('Eagle Mountain'))
  assert.ok(PROJECT_REGISTER.some((e) => e.name === 'Eagle Mountain'))
})

test("the portfolio claim does not reconcile with its own pipeline", () => {
  // The same report: 3,867 MW of "powered projects" against a 73.3-93.4 MW
  // tracked GPUaaS pipeline.
  const flags = flagPortfolioReconciliation(3867, 73.3, 93.4)
  assert.ok(codes(flags).includes('portfolio_does_not_reconcile'))
  assert.ok(flags[0].title.includes('41x'), 'the multiple itself is the signal')

  // A portfolio within range of the pipeline raises nothing.
  assert.equal(flagPortfolioReconciliation(100, 73.3, 93.4).length, 0)
})

test('a fee cap breach and an untested cap are different flags', () => {
  const base = {
    phaseLabel: 'Phase 1',
    costA: 700 * M,
    costB: 200 * M,
    costC: 100 * M,
    performsDevelopmentManagement: true,
    scopeBMode: 'epcm' as const,
    lumpSumAgreed: false,
    utilityBuiltWorkCost: null,
  }

  // Under the cap: no flag at all.
  assert.equal(flagFeeResult(computePhaseFees({ ...base, tpc: 1000 * M })).length, 0)

  // Over the cap: a question naming the waterfall.
  const over = flagFeeResult(computePhaseFees({ ...base, tpc: 400 * M }))
  assert.ok(codes(over).includes('fee_cap_applied'))

  // No TPC at all: a blocker, because nothing is final.
  const untested = flagFeeResult(computePhaseFees({ ...base, tpc: null }))
  assert.ok(codes(untested).includes('cap_untested'))
  assert.equal(untested[0].severity, 'blocker')
})

test('the facility loading is tested against the fees it has to hold', () => {
  // The 74 MW reference: $586M direct, 21.1% loading = $124.2M, against roughly
  // $48M of Schedule 1 fees on those scopes. Thin but not impossible.
  const thin = flagFacilityLoading(586 * M, 1.211, 48 * M)
  assert.ok(thin.length === 0 || codes(thin).includes('loading_thin'))

  // Fees larger than the whole loading is a blocker.
  const impossible = flagFacilityLoading(586 * M, 1.211, 200 * M)
  assert.ok(codes(impossible).includes('loading_cannot_hold_fees'))
  assert.equal(impossible[0].severity, 'blocker')

  // A generous loading raises nothing.
  assert.equal(flagFacilityLoading(586 * M, 1.4, 48 * M).length, 0)
})

test("Steelton's actual PCA blanks are flagged, capacity and estimates as blockers", () => {
  const flags = flagPcaBlanks('Steelton', {
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
  })

  const blockers = flags.filter((f) => f.severity === 'blocker')
  assert.equal(blockers.length, 2, 'per-phase capacity and cost estimates block a number')
  assert.ok(blockers.some((f) => f.title.includes('Planned IT Capacity')))
  assert.ok(blockers.some((f) => f.title.includes('cost estimates')))
  // The rest are gathered rather than listed one by one.
  assert.ok(flags.some((f) => f.code === 'pca_blanks_open'))

  // A fully completed PCA raises nothing.
  const none = flagPcaBlanks('Hypothetical', {
    acreage: false, projectCompanyName: false, tensorIqFundingAmount: false,
    tensorIqFundingProof: false, berWilsonEquity: false, reservedCapacity: false,
    deploymentMilestoneDates: false, offtakeMilestoneDate: false,
    powerAuthorizationDeadlines: false, steeringCommitteeMembers: false,
    phaseCapacities: false, phaseCostEstimates: false,
  })
  assert.equal(none.length, 0)
})

test('blockers sort above questions, which sort above notes', () => {
  const sorted = sortFlags([
    { severity: 'note', code: 'n', title: '', detail: '', resolution: '' },
    { severity: 'blocker', code: 'b', title: '', detail: '', resolution: '' },
    { severity: 'question', code: 'q', title: '', detail: '', resolution: '' },
  ])
  assert.deepEqual(codes(sorted), ['b', 'q', 'n'])
})
