/**
 * Role protection is held to the agreement's own illustration, and to the
 * Steelton PCA's own statement of its stage.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PhaseFeeInput } from './fees'
import {
  computeRoleProtection,
  computeTensorIqProtection,
  determineStage,
  protectionCap,
  STAGE_PCT,
  type ProtectionInput,
} from './protection'

const M = 1_000_000
const near = (actual: number, expected: number, tol: number, what: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${what}: expected ~${expected.toLocaleString()}, got ${actual.toLocaleString()}`
  )

const illustrationFees: PhaseFeeInput = {
  phaseLabel: 'Illustration',
  costA: 700 * M,
  costB: 200 * M,
  costC: 100 * M,
  tpc: 1000 * M,
  performsDevelopmentManagement: true,
  scopeBMode: 'epcm',
  lumpSumAgreed: false,
  utilityBuiltWorkCost: null,
}

function base(overrides: Partial<ProtectionInput> = {}): ProtectionInput {
  return {
    phaseLabel: 'Illustration',
    facts: {
      holdsSiteControl: true,
      pcaOrAcknowledgmentSigned: true,
      scopeAgreementSigned: false,
    },
    fees: illustrationFees,
    scopeBAlreadyConverted: false,
    feesAlreadyEarned: 0,
    affectedItMw: null,
    estimatedTpc: 1000 * M,
    powerAmount: null,
    earnedUnpaidFees: 0,
    unreimbursedPursuitCosts: 0,
    ...overrides,
  }
}

test('the stage is set by paperwork, not by whether an estimate exists', () => {
  assert.equal(
    determineStage({
      holdsSiteControl: false,
      pcaOrAcknowledgmentSigned: false,
      scopeAgreementSigned: false,
    }),
    1
  )
  // Site control ALONE is enough for Stage 2 — this is Steelton's position.
  assert.equal(
    determineStage({
      holdsSiteControl: true,
      pcaOrAcknowledgmentSigned: false,
      scopeAgreementSigned: false,
    }),
    2
  )
  // So is a signed PCA alone, with no site control.
  assert.equal(
    determineStage({
      holdsSiteControl: false,
      pcaOrAcknowledgmentSigned: true,
      scopeAgreementSigned: false,
    }),
    2
  )
  // A signed Scope Agreement takes it to Stage 3 whatever else is true.
  assert.equal(
    determineStage({
      holdsSiteControl: false,
      pcaOrAcknowledgmentSigned: false,
      scopeAgreementSigned: true,
    }),
    3
  )
  assert.deepEqual(STAGE_PCT, { 1: 10, 2: 25, 3: 40 })
})

test('Schedule 1 illustration: all three stage amounts', () => {
  // Stage 1 — no site control, nothing signed. 10% of $76.0M.
  const s1 = computeRoleProtection(
    base({
      facts: {
        holdsSiteControl: false,
        pcaOrAcknowledgmentSigned: false,
        scopeAgreementSigned: false,
      },
    })
  )
  assert.equal(s1.stage, 1)
  near(s1.unearnedFees ?? 0, 76 * M, 1, 'unearned fees exclude preconstruction')
  near(s1.payable ?? 0, 7.6 * M, 1, 'Stage 1 = $7.6M')

  // Stage 2 — 25% of $76.0M.
  const s2 = computeRoleProtection(base())
  assert.equal(s2.stage, 2)
  near(s2.payable ?? 0, 19 * M, 1, 'Stage 2 = $19.0M')
  assert.equal(s2.capApplied, false)

  // Stage 3 — 40% of $76.0M is $30.4M, capped at 3.0% of $1B = $30.0M.
  const s3 = computeRoleProtection(
    base({
      facts: {
        holdsSiteControl: true,
        pcaOrAcknowledgmentSigned: true,
        scopeAgreementSigned: true,
      },
    })
  )
  assert.equal(s3.stage, 3)
  near(s3.stageAmount ?? 0, 30.4 * M, 1, 'uncapped Stage 3 = $30.4M')
  assert.equal(s3.capApplied, true, 'the cap bites at Stage 3')
  near(s3.payable ?? 0, 30 * M, 1, 'Stage 3 payable = $30.0M')
})

test('the cap is 3.0% of the first $1B and 2.5% above it', () => {
  near(protectionCap(1000 * M), 30 * M, 1, 'exactly $1B')
  near(protectionCap(500 * M), 15 * M, 1, 'below $1B')
  // $3B = 3% of 1,000 + 2.5% of 2,000 = 30 + 50.
  near(protectionCap(3000 * M), 80 * M, 1, 'above $1B')
  assert.equal(protectionCap(0), 0)
})

test('Scope B is valued at the EPCM rate unless the conversion already happened', () => {
  // A phase whose Scope B could convert, but has not.
  const notConverted = computeRoleProtection(
    base({ fees: { ...illustrationFees, scopeBMode: 'fixed_price' } })
  )
  near(notConverted.unearnedFees ?? 0, 76 * M, 1, 'valued at 7%, giving $76.0M')
  assert.ok(notConverted.notes.some((n) => n.includes('7.0% EPCM rate')))

  // Once converted, the 12% rate stands: $86.0M.
  const converted = computeRoleProtection(
    base({
      fees: { ...illustrationFees, scopeBMode: 'fixed_price' },
      scopeBAlreadyConverted: true,
    })
  )
  near(converted.unearnedFees ?? 0, 86 * M, 1, 'valued at 12%, giving $86.0M')
})

test('fees already earned come out of the base', () => {
  const r = computeRoleProtection(base({ feesAlreadyEarned: 16 * M }))
  near(r.unearnedFees ?? 0, 60 * M, 1, '$76.0M less $16.0M earned')
  near(r.payable ?? 0, 15 * M, 1, '25% of $60.0M')
})

test('no estimate falls back to per-MW at Stages 1 and 2, and blocks at Stage 3', () => {
  const s2 = computeRoleProtection(
    base({ fees: null, estimatedTpc: null, affectedItMw: 900 })
  )
  assert.equal(s2.usedFallback, true)
  assert.equal(s2.fallbackPerMw, 150_000)
  near(s2.payable ?? 0, 135 * M, 1, '900 MW x $150k')
  // ⚠ The fallback exists because there is no estimate, but the cap needs one.
  assert.ok(
    s2.notes.some((n) => n.includes('uncapped maximum')),
    'an untestable cap must be said out loud'
  )

  const s1 = computeRoleProtection(
    base({
      fees: null,
      estimatedTpc: null,
      affectedItMw: 900,
      facts: {
        holdsSiteControl: false,
        pcaOrAcknowledgmentSigned: false,
        scopeAgreementSigned: false,
      },
    })
  )
  near(s1.payable ?? 0, 45 * M, 1, '900 MW x $50k')

  // Stage 3 has no fallback at all.
  const s3 = computeRoleProtection(
    base({
      fees: null,
      estimatedTpc: null,
      affectedItMw: 900,
      facts: {
        holdsSiteControl: true,
        pcaOrAcknowledgmentSigned: true,
        scopeAgreementSigned: true,
      },
    })
  )
  assert.equal(s3.payable, null)
  assert.ok(s3.blockers.some((b) => b.includes('Stage 3 has no per-MW fallback')))
})

test('the per-MW fallback is still capped where an estimate does exist', () => {
  // 900 MW x $150k = $135M, against a cap on $1B of TPC = $30M.
  const r = computeRoleProtection(
    base({ fees: null, estimatedTpc: 1000 * M, affectedItMw: 900 })
  )
  assert.equal(r.usedFallback, true)
  near(r.stageAmount ?? 0, 135 * M, 1, '900 MW x $150k before the cap')
  assert.equal(r.capApplied, true)
  near(r.payable ?? 0, 30 * M, 1, 'the cap governs, not the per-MW figure')
})

test('a blank power amount is zero and says so', () => {
  const r = computeRoleProtection(base())
  assert.equal(r.powerAmount, 0)
  assert.ok(r.notes.some((n) => n.includes('no amount is implied')))

  // A stated amount is added before the cap, which covers the whole event.
  const withPower = computeRoleProtection(base({ powerAmount: 5 * M }))
  near(withPower.amountBeforeCap ?? 0, 24 * M, 1, '$19.0M + $5.0M')
  near(withPower.payable ?? 0, 24 * M, 1, 'still under the $30.0M cap')

  const capped = computeRoleProtection(base({ powerAmount: 20 * M }))
  near(capped.amountBeforeCap ?? 0, 39 * M, 1, '$19.0M stage + $20.0M power')
  assert.equal(capped.capApplied, true)
  near(capped.payable ?? 0, 30 * M, 1, 'the cap covers the power amount too')
})

test('earned unpaid fees and pursuit costs sit outside the cap', () => {
  const r = computeRoleProtection(
    base({ earnedUnpaidFees: 2 * M, unreimbursedPursuitCosts: 750_000 })
  )
  near(r.payable ?? 0, 19 * M, 1, 'the capped payment is unchanged')
  near(r.separatelyRecoverable, 2.75 * M, 1, 'earned unpaid plus pursuit costs')
  near(r.totalClaim ?? 0, 21.75 * M, 1, 'the whole claim')
})

test("TensorIQ's own protection is tracked as a liability", () => {
  // A stated amount governs.
  const stated = computeTensorIqProtection({
    statedAmount: 4 * M,
    projectedNetFees36Months: 100 * M,
    deploymentMilestonesMet: true,
  })
  assert.equal(stated.amount, 4 * M)
  assert.equal(stated.basis, 'stated_in_pca')

  // Blank falls to the formula: 25% of 36-month net fees.
  const formula = computeTensorIqProtection({
    statedAmount: null,
    projectedNetFees36Months: 100 * M,
    deploymentMilestonesMet: true,
  })
  near(formula.amount ?? 0, 25 * M, 1, '25% of $100M')

  // Milestones not met: nothing is payable.
  const missed = computeTensorIqProtection({
    statedAmount: null,
    projectedNetFees36Months: 100 * M,
    deploymentMilestonesMet: false,
  })
  assert.equal(missed.amount, 0)

  // Milestones met but no projection: cannot be computed, not zero.
  const unknown = computeTensorIqProtection({
    statedAmount: null,
    projectedNetFees36Months: null,
    deploymentMilestonesMet: true,
  })
  assert.equal(unknown.amount, null)
})
