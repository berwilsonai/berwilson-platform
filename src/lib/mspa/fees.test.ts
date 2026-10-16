/**
 * The fee engine is held to the SIGNED agreement's own illustration.
 *
 * Schedule 1 of the executed MSPA prints a $1.0B worked example with every
 * intermediate figure. If any rate, tier bound or waterfall step here drifts,
 * these assertions name it. The illustration is the contract's, not ours, so
 * reproducing it is the only evidence that the code reads Schedule 1 correctly.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AGGREGATE_FEE_CAP_PCT,
  applyTiers,
  computePhaseFees,
  computeProjectFees,
  SCOPE_A_TIERS,
  SCOPE_C_TIERS,
  SCOPE_D_TIERS,
  type PhaseFeeInput,
} from './fees'

const M = 1_000_000

/** The agreement's illustration: $1.0B TPC, excluding land. */
function illustration(overrides: Partial<PhaseFeeInput> = {}): PhaseFeeInput {
  return {
    phaseLabel: 'Illustration',
    costA: 700 * M,
    costB: 200 * M,
    costC: 100 * M,
    tpc: 1000 * M,
    performsDevelopmentManagement: true,
    scopeBMode: 'epcm',
    lumpSumAgreed: false,
    utilityBuiltWorkCost: null,
    ...overrides,
  }
}

const near = (actual: number, expected: number, tolerance: number, what: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected ~${expected.toLocaleString()}, got ${actual.toLocaleString()}`
  )

test('marginal tiers apply only to the slice inside each band', () => {
  // Scope A on $700M = 4% of the first $500M + 3% of the next $200M.
  assert.equal(applyTiers(700 * M, SCOPE_A_TIERS), 26 * M)
  // Read as a cliff rate at 3% this would be $21M, and at 4% $28M. Neither is right.
  assert.notEqual(applyTiers(700 * M, SCOPE_A_TIERS), 21 * M)
  assert.notEqual(applyTiers(700 * M, SCOPE_A_TIERS), 28 * M)

  // Exactly on a band bound.
  assert.equal(applyTiers(500 * M, SCOPE_A_TIERS), 20 * M)
  // Into the third band: 4%*500 + 3%*1500 + 2.5%*1000 = 20 + 45 + 25.
  assert.equal(applyTiers(3000 * M, SCOPE_A_TIERS), 90 * M)

  assert.equal(applyTiers(100 * M, SCOPE_C_TIERS), 6 * M)
  // $300M = 6%*100 + 4%*200 = 6 + 8.
  assert.equal(applyTiers(300 * M, SCOPE_C_TIERS), 14 * M)

  assert.equal(applyTiers(1000 * M, SCOPE_D_TIERS), 30 * M)
  // $4B = 3%*1000 + 2%*2000 + 1.5%*1000 = 30 + 40 + 15.
  assert.equal(applyTiers(4000 * M, SCOPE_D_TIERS), 85 * M)

  assert.equal(applyTiers(0, SCOPE_A_TIERS), 0)
  assert.throws(() => applyTiers(-1, SCOPE_A_TIERS), /negative/)
})

test('Schedule 1 illustration, EPCM default: every line of the contract table', () => {
  const r = computePhaseFees(illustration())
  const fee = (s: string) => r.scopes.find((x) => x.scope === s)?.fee ?? 0

  near(fee('A'), 26 * M, 1, 'A on $700M')
  near(fee('B'), 14 * M, 1, 'B on $200M at 7%')
  near(fee('C'), 6 * M, 1, 'C on $100M')
  near(fee('D'), 30 * M, 1, 'D on $1,000M TPC')
  near(r.preconstructionFee, 5 * M, 1, 'preconstruction 0.5% of A+B+C')
  near(r.totalFees, 81 * M, 1, 'total fees $81.0M')
  near(r.totalPctOfTpc ?? 0, 8.1, 0.001, 'total as % of TPC')

  // The cap is tested on Scope A-D only, excluding preconstruction: 7.6%.
  near(r.cappedScopeFees, 76 * M, 1, 'Scope A-D fees')
  near(r.effectiveScopePctOfTpc ?? 0, 7.6, 0.001, 'Scope A-D as % of TPC')
  assert.equal(r.capApplied, false, 'at 7.6% the 9.0% cap does not bite')
  assert.equal(r.capAmount, 90 * M)
})

test('Schedule 1 illustration, Scope B converted to fixed price', () => {
  const r = computePhaseFees(illustration({ scopeBMode: 'fixed_price' }))
  const fee = (s: string) => r.scopes.find((x) => x.scope === s)?.fee ?? 0

  near(fee('B'), 24 * M, 1, 'B on $200M at 12%')
  near(r.totalFees, 91 * M, 1, 'total fees $91.0M')
  near(r.cappedScopeFees, 86 * M, 1, 'Scope A-D fees')
  near(r.effectiveScopePctOfTpc ?? 0, 8.6, 0.001, 'Scope A-D still under the 9.0% cap')
  assert.equal(r.capApplied, false)

  // ⚠ The contract table prints this row as "$91.0M (9.1%)", which reads like a
  // cap breach and is not one: the cap excludes preconstruction, and 8.6% < 9.0%.
  near(r.totalPctOfTpc ?? 0, 9.1, 0.001, 'all-in including preconstruction')
})

test('a breach small enough stops at Scope D and never reaches A, B or C', () => {
  // $600M TPC: gross A-D = 26 + 14 + 6 + 18 = $64M against a $54M cap, so the
  // excess is $10M and Scope D's $18M absorbs all of it.
  const r = computePhaseFees(illustration({ tpc: 600 * M }))
  const scope = (s: string) => r.scopes.find((x) => x.scope === s)!

  assert.equal(r.capApplied, true)
  near(r.capAmount ?? 0, 54 * M, 1, '9% of $600M')
  near(scope('D').capReduction, 10 * M, 1, 'D absorbs the whole excess')
  near(scope('D').fee, 8 * M, 1, 'and is reduced, not zeroed')
  assert.equal(scope('A').capReduction, 0, 'A is untouched')
  assert.equal(scope('B').capReduction, 0, 'B is untouched')
  assert.equal(scope('C').capReduction, 0, 'C is untouched')
  near(r.cappedScopeFees, 54 * M, 1, 'fees land exactly on the cap')
})

test('a larger breach zeroes Scope D, then cuts A, B and C proportionately', () => {
  // $400M TPC: gross A-D = 26 + 14 + 6 + 12 = $58M against a $36M cap. The
  // excess is $22M, D's $12M goes first, and the remaining $10M is shared.
  const r = computePhaseFees(illustration({ tpc: 400 * M }))
  const scope = (s: string) => r.scopes.find((x) => x.scope === s)!

  assert.equal(r.capApplied, true)
  near(r.capAmount ?? 0, 36 * M, 1, '9% of $400M')
  assert.equal(scope('D').fee, 0, 'Scope D is reduced to zero first')
  near(scope('D').capReduction, 12 * M, 1, 'the whole Scope D fee')
  near(r.cappedScopeFees, 36 * M, 1, 'fees land exactly on the cap')

  const a = scope('A')
  const b = scope('B')
  const c = scope('C')
  const pool = a.grossFee + b.grossFee + c.grossFee
  const remaining = 10 * M
  near(a.capReduction, remaining * (a.grossFee / pool), 1, 'A share of the residual cut')
  near(b.capReduction, remaining * (b.grossFee / pool), 1, 'B share of the residual cut')
  near(c.capReduction, remaining * (c.grossFee / pool), 1, 'C share of the residual cut')
  // Proportionate means the ratio between them is preserved.
  near(a.capReduction / c.capReduction, a.grossFee / c.grossFee, 1e-9, 'ratio preserved')
})

test('a converted Scope B with an agreed lump sum is never reduced by the cap', () => {
  const r = computePhaseFees(
    illustration({ scopeBMode: 'fixed_price', lumpSumAgreed: true, tpc: 600 * M })
  )
  const b = r.scopes.find((x) => x.scope === 'B')!
  assert.equal(b.capReduction, 0, 'Section 8.9 holds it out of the waterfall')
  near(b.fee, 24 * M, 1, 'the converted fee stands')
  assert.ok(r.notes.some((n) => n.includes('cap-exempt') || n.includes('cap waterfall')))
})

test('utility coordination sits outside the cap and outside TPC', () => {
  const r = computePhaseFees(illustration({ utilityBuiltWorkCost: 200 * M }))
  near(r.utilityCoordinationFee, 3 * M, 1, '1.5% of owner payments to the utility')
  // It is added to what Ber Wilson invoices but never into the capped quantity.
  near(r.cappedScopeFees, 76 * M, 1, 'the capped quantity is unchanged')
  near(r.totalFees, 84 * M, 1, '$81.0M + $3.0M')
  assert.equal(r.capApplied, false)
})

test('no TPC means no cap test, and the result says so', () => {
  const r = computePhaseFees(illustration({ tpc: null }))
  assert.equal(r.capAmount, null)
  assert.equal(r.capApplied, false)
  assert.ok(
    r.notes.some((n) => n.includes('Aggregate Fee Cap could not be tested')),
    'an untested cap must be stated, not implied'
  )
  // Scope D cannot be computed either, and that is also said out loud.
  assert.equal(r.scopes.find((x) => x.scope === 'D'), undefined)
  assert.ok(r.notes.some((n) => n.includes('Scope D fee cannot be calculated')))
})

test('development management is only charged where Ber Wilson performs it', () => {
  const r = computePhaseFees(illustration({ performsDevelopmentManagement: false }))
  assert.equal(r.scopes.find((x) => x.scope === 'D'), undefined)
  near(r.totalFees, 51 * M, 1, '$81.0M less the $30.0M Scope D fee')
})

test('preconstruction covers Scopes A to C only, never D', () => {
  const r = computePhaseFees(illustration())
  assert.deepEqual(r.preconstructionScopes, ['A', 'B', 'C'])
  assert.equal(r.preconstructionBase, 1000 * M)

  // ⚠ The base is Cost of the Work, not TPC. The illustration cannot tell them
  // apart because A+B+C happens to equal TPC there. Make them differ and the
  // preconstruction fee must follow the scope costs, not the TPC.
  const soft = computePhaseFees(illustration({ tpc: 1200 * M }))
  assert.equal(soft.preconstructionBase, 1000 * M, 'still A+B+C, not the $1.2B TPC')
  near(soft.preconstructionFee, 5 * M, 1, 'follows the scope costs')
})

test('phases are never combined to climb a tier', () => {
  const one = computeProjectFees([
    illustration({ phaseLabel: 'P1' }),
    illustration({ phaseLabel: 'P2' }),
  ])
  // Two $1B phases: Scope D is 3% on each, so $60M.
  near(one.totalScopeFees, 152 * M, 1, 'two $1B phases')
  near(one.totalFees, 162 * M, 1, 'plus preconstruction on each')

  // The same $2B tiered as ONE base would give Scope D 3%*1000 + 2%*1000 = $50M,
  // and Scope A 4%*500 + 3%*900 = $47M against $52M. Combining is not neutral.
  const combined = computePhaseFees(
    illustration({ costA: 1400 * M, costB: 400 * M, costC: 200 * M, tpc: 2000 * M })
  )
  assert.notEqual(combined.cappedScopeFees, one.totalScopeFees)
})

test('the cap constant is the agreement figure', () => {
  assert.equal(AGGREGATE_FEE_CAP_PCT, 9.0)
})
