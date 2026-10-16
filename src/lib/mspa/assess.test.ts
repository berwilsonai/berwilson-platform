/**
 * The orchestrator, held to the real records.
 *
 * These are the assertions that matter commercially: that Steelton's signed
 * position comes out right, that an unconfirmed basis refuses to resolve, and
 * that the Whiskey site reproduces the TensorIQ reference case — because it is
 * the one record on the register at the same scale as their worked example.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assessOpportunity, type OpportunitySpec } from './assess'
import { specFromParams } from './params'
import { MSPA_REGISTER, summarizeRegister } from './register'

const M = 1_000_000

const codes = (a: { flags: { code: string }[] }) => a.flags.map((f) => f.code)

test('Steelton comes out at its signed contractual position', () => {
  const a = assessOpportunity(specFromParams({ record: 'Steelton — Cleveland-Cliffs (PA)' }))

  // The PCA settles the basis: 900 MW is Planned IT Capacity, so IT load.
  assert.equal(a.capacity?.itMw, 900)
  assert.equal(a.capacity?.utilityMw, 1260, '900 IT MW at PUE 1.4')
  assert.equal(a.capacity?.statedBasis, 'it')
  assert.equal(a.bothReadings, null, 'the basis is known, so no ambiguity is shown')

  // Scopes A-D are all held, per PCA item 7.
  assert.deepEqual(
    a.phases[0].fees.scopes.map((s) => s.scope),
    ['A', 'B', 'C', 'D']
  )
  // Scope B at the 7.0% EPCM rate: the PCA says "Fixed-price conversion exception: none."
  assert.equal(a.phases[0].fees.scopes.find((s) => s.scope === 'B')?.flatRatePct, 7)

  // Stage 2 (Secured) on every phase, by the PCA's own words.
  assert.equal(a.phases[0].protection.stage, 2)
  assert.equal(a.phases[0].protection.stageLabel, 'Secured')

  // The power role protection amount is blank, so zero — never derived.
  assert.equal(a.phases[0].protection.powerAmount, 0)
  assert.ok(
    a.assumptions.some((x) => x.field === 'Power role protection amount' && x.value === '$0')
  )

  // Both PCA blanks that block a number are blockers.
  assert.ok(codes(a).includes('pca_blank_phaseCapacities'))
  assert.ok(codes(a).includes('pca_blank_phaseCostEstimates'))

  // ⚠ And the cost base is modelled, which must be stated, not implied.
  assert.equal(a.phases[0].costsAreModelled, true)
  assert.ok(a.assumptions.some((x) => x.source.includes('every fee below is modelled')))
})

test('a modelled cost base sends protection down the per-MW fallback', () => {
  const a = assessOpportunity(specFromParams({ record: 'Steelton — Cleveland-Cliffs (PA)' }))
  const p = a.phases[0].protection

  // A figure out of the TensorIQ model is not a "reliable cost estimate" for
  // Section 9.4, so Stage 2 falls back to $150k per affected IT MW.
  assert.equal(p.usedFallback, true)
  assert.equal(p.fallbackPerMw, 150_000)
  assert.equal(p.payable, 900 * 150_000, '900 IT MW x $150k = $135M')
  assert.ok(
    p.notes.some((n) => n.includes('uncapped maximum')),
    'with no estimate there is no cap to apply, and that must be said'
  )
})

test('an unconfirmed basis refuses to resolve and shows both readings', () => {
  const a = assessOpportunity(specFromParams({ record: 'Weirton — Cleveland-Cliffs (WV)' }))

  assert.equal(a.capacity, null, 'nothing is adopted')
  assert.ok(a.bothReadings, 'both readings are offered instead')
  assert.equal(a.bothReadings?.asIt, 300 * 1.4, '300 read as IT gives 420 utility')
  assert.ok(Math.abs((a.bothReadings?.asUtility ?? 0) - 300 / 1.4) < 0.01)
  assert.ok(codes(a).includes('mw_basis_unconfirmed'))
  assert.equal(
    a.flags.find((f) => f.code === 'mw_basis_unconfirmed')?.severity,
    'blocker'
  )
})

test('Whiskey reproduces the TensorIQ reference case, being the same scale', () => {
  const a = assessOpportunity(specFromParams({ record: 'Whiskey (TX)' }))

  // 74.9 MW is an Oncor interconnection tranche, so unambiguously utility load.
  assert.equal(a.capacity?.statedBasis, 'utility')
  assert.equal(a.capacity?.utilityMw, 74.9)
  assert.ok(Math.abs((a.capacity?.itMw ?? 0) - 53.5) < 0.1, '53.5 IT MW at PUE 1.4')

  // The facility cost must land on the tearsheet's $9.6M per utility MW.
  const facility = a.phases[0].facility
  assert.ok(facility)
  assert.ok(
    Math.abs(facility.loadedPerUtilityMw - 9.6 * M) / (9.6 * M) < 0.02,
    `facility per utility MW: ${(facility.loadedPerUtilityMw / M).toFixed(2)}M, expected ~9.6M`
  )

  // No site control and no PCA, so Stage 1.
  assert.equal(a.phases[0].protection.stage, 1)
  assert.equal(a.phases[0].protection.fallbackPerMw, 50_000)

  // And it is clean: no blockers, because the basis is known.
  assert.equal(a.flags.filter((f) => f.severity === 'blocker').length, 0)
})

test('phases adding to more than the project is a blocker', () => {
  // Steelton's grid roadmap reads 300 / 500 / 700 MW. Entered as increments
  // that is 1,500 MW against a Planned IT Capacity of 900.
  const a = assessOpportunity(
    specFromParams({ record: 'Steelton — Cleveland-Cliffs (PA)', phases: '300,500,700' })
  )
  assert.ok(codes(a).includes('phases_exceed_project'))
  const flag = a.flags.find((f) => f.code === 'phases_exceed_project')!
  assert.equal(flag.severity, 'blocker')
  assert.ok(flag.detail.includes('1,500'))
  assert.ok(flag.detail.includes('900'))

  // Entered as the increments they imply (300, 200, 200), it is fine.
  const ok = assessOpportunity(
    specFromParams({ record: 'Steelton — Cleveland-Cliffs (PA)', phases: '300,200,200' })
  )
  assert.ok(!codes(ok).includes('phases_exceed_project'))
})

test("a register record never collides with itself", () => {
  // ⚠ The collision flag is for a COUNTERPARTY's label. Run against our own
  // record it fires on itself, which trains a reader to ignore the flag list.
  for (const record of MSPA_REGISTER.filter((r) => r.mspaScope === 'in')) {
    const a = assessOpportunity(specFromParams({ record: record.name }))
    assert.ok(
      !codes(a).includes('register_collision'),
      `${record.name} must not be flagged as colliding with itself`
    )
  }

  // An external label still collides.
  const external = assessOpportunity({
    name: 'Chicago, IL — 300 MW',
    state: 'IL',
    statedMw: 300,
    mwBasis: 'utility',
    cooling: 'dlc',
    phases: [{ label: 'Whole', mw: 300, scopeAgreementSigned: false }],
    scopesHeld: ['A', 'B', 'C'],
    scopeBMode: 'epcm',
    lumpSumAgreed: false,
    siteControl: false,
    pcaSigned: false,
  } satisfies OpportunitySpec)
  assert.ok(codes(external).includes('register_collision'))
})

test('a record with no capacity says so instead of returning zeroes', () => {
  const a = assessOpportunity(specFromParams({ record: 'Delta Industrial Campus — Daves Farms' }))
  assert.equal(a.capacity, null)
  assert.equal(a.bothReadings, null)
  assert.equal(a.totalFees, 0, 'no capacity means no fee, not a small fee')
  assert.ok(
    a.missing.some((x) => x.field.includes('Planned IT Capacity')),
    'the missing input must be named'
  )
})

test('the URL round-trips, so a figure quoted on a call is a link', () => {
  const a = assessOpportunity(
    specFromParams({ record: 'Whiskey (TX)', mw: '100', basis: 'it', cooling: 'immersion' })
  )
  // The URL overrides the register.
  assert.equal(a.capacity?.itMw, 100)
  assert.equal(a.capacity?.pue, 1.2, 'immersion')
  assert.equal(a.capacity?.utilityMw, 120)
})

test('the register summary is derived, never written by hand', () => {
  const s = summarizeRegister()
  assert.equal(s.total, MSPA_REGISTER.length)
  assert.equal(s.inScope + s.unsized + s.outOfScope, s.total, 'every record is classified')
  assert.equal(s.withSignedPca, 1, 'only Steelton has a signed PCA')
  assert.equal(s.withCostEstimate, 0, 'no record has a cost estimate')
  // Every in-scope record must carry a rationale and a capacity or be unsized.
  for (const r of MSPA_REGISTER) {
    assert.ok(r.rationale.length > 20, `${r.name} needs a rationale`)
    if (r.mspaScope === 'in') assert.ok(r.statedMw != null, `${r.name} is in scope but unsized`)
  }
})
