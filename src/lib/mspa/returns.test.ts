/**
 * Returns are checked against the tearsheet where it publishes a figure, and
 * for the properties Part E insists on everywhere else.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  capitalRecoveryFactor,
  computeOperating,
  computeRealEstate,
  computeReturns,
  DSCR_COVENANT,
  powerRateInconsistency,
  priceResidualSwap,
  rateSensitivity,
  SCENARIOS,
  TENSORIQ_PUBLISHED,
} from './returns'
import { computeFacilityCost, sizeDeployment } from './sizing'

const M = 1_000_000
const B = 1_000_000_000

const close = (actual: number, published: number, pctTol: number, what: string) => {
  const drift = Math.abs(actual - published) / Math.abs(published)
  assert.ok(
    drift <= pctTol / 100,
    `${what}: expected ~${published.toLocaleString()}, got ${actual.toLocaleString()} (${(drift * 100).toFixed(2)}% off)`
  )
}

/** The 74 MW reference deployment, built from the sizing module. */
function reference() {
  const s = sizeDeployment({ gpuGeneration: 'gb300', cooling: 'dlc', gpuCount: 27_072 })
  const f = computeFacilityCost(s.capacity, 'dlc')
  return {
    utilityMw: s.capacity.utilityMw,
    gpuCount: s.gpuCount,
    hardwareCost: s.hardwareCost,
    facilityCost: f.loadedTotal,
  }
}

test('the capital recovery factor matches the model constant', () => {
  close(capitalRecoveryFactor(0.1, 4), 0.3155, 0.1, 'CRF at 10% over 4 years')
  // A zero rate is straight-line.
  assert.equal(capitalRecoveryFactor(0, 5), 0.2)
})

test('TLH_74MW_14OCT2026: the annual expense stack reproduces the tearsheet', () => {
  const op = computeOperating(reference())

  close(op.annualFacilityLease, 127.9 * M, 1, 'annual lease at 18% yield on cost')
  close(op.annualPower, 58.4 * M, 1, 'annual power 24/7 at $0.09')
  close(op.annualOpex, 74.0 * M, 1, 'annual opex at $1.0M per utility MW')
  close(op.annualRackRent, 186.2 * M, 1, 'rack rent = lease + power')
  close(op.revenuePerUtilityMwYear, 20.6 * M, 2, 'revenue per utility MW-year')
})

test('the stated power blend does not produce the stated rate', () => {
  const b = powerRateInconsistency()
  assert.equal(b.statedBlended, 0.09)
  // 80% at $0.09 + 20% at $0.18 = $0.108.
  close(b.impliedByComponents, 0.108, 0.01, 'implied blend')
  close(b.understatementPct, 16.67, 0.1, 'the stated rate is 16.7% light')

  // And the caveat must reach the caller rather than living in a comment.
  const op = computeOperating(reference())
  assert.ok(
    op.caveats.some((c) => c.includes('understates the cost')),
    'the power blend inconsistency must be raised'
  )
})

test('TCO assumes a leased facility, so facility capex is never added on top', () => {
  const ref = reference()
  const op = computeOperating(ref)
  // TCO = hardware + 7 x (rack rent + opex). The facility appears only through
  // the lease inside rack rent, never as capex.
  close(op.tcoSevenYear, ref.hardwareCost + 7 * (op.annualRackRent + op.annualOpex), 0.001, 'TCO')
  assert.ok(
    op.tcoSevenYear < ref.hardwareCost + ref.facilityCost + 7 * (op.annualRackRent + op.annualOpex),
    'adding facility capex on top would double count the building'
  )
})

test('the lease tenor outruns the contract term, and that is said out loud', () => {
  const op = computeOperating(reference())
  assert.ok(
    op.caveats.some((c) => c.includes('no contracted revenue behind it')),
    '15-year lease against a 5-year contract leaves a 10-year tail'
  )
})

test('returns come back as a scenario set, never as one number', () => {
  const rs = computeReturns(reference())
  assert.ok(rs.length >= 3, 'a base case alone is not an answer')
  assert.equal(rs[0].label, 'TensorIQ modelled case')
  assert.ok(
    rs[0].note.includes('not a forecast'),
    "the base case must be labelled TensorIQ's own"
  )
  // Every haircut must be worse than the base case.
  for (const r of rs.slice(1)) {
    assert.ok((r.moic ?? 0) < (rs[0].moic ?? 0), `${r.label} must be below the base case`)
  }
  // No scenario, including the base, carries platform and software revenue.
  assert.ok(SCENARIOS.every((s) => !s.includePlatformRevenue), 'resale is contractually barred')
})

test('returns are brutally sensitive to the contract rate', () => {
  // At TensorIQ's own equity base the leverage is extreme: $149.4M of equity
  // under $3.97B of capex. That is what makes the return a pure bet on rate.
  const sens = rateSensitivity(reference(), [0, 0.1, 0.17, 0.25, 0.33, 0.4], {
    equityInvested: TENSORIQ_PUBLISHED.equityRequired,
  })
  const base = sens.find((s) => s.cutPct === 0)!
  const cut17 = sens.find((s) => s.cutPct === 17)!
  const cut33 = sens.find((s) => s.cutPct === 33)!

  assert.ok((base.moic ?? 0) > 5, 'the modelled case is a very large multiple')

  // More cut is never a better return, at any equity base.
  for (let i = 1; i < sens.length; i++) {
    assert.ok(
      (sens[i].moic ?? -Infinity) <= (sens[i - 1].moic ?? Infinity) + 1e-9,
      'MOIC must fall monotonically as the rate is cut'
    )
  }

  // EBITDA itself must fall hard, and a large cut must destroy it. This is the
  // property that holds whatever the equity base is, so it is what we assert.
  // A rate cut lands on EBITDA AMPLIFIED, because the cost base is fixed: a
  // 33% revenue cut takes ~40% off EBITDA. That amplification is the property
  // that holds regardless of the equity base, so it is what we assert.
  const amplification =
    (1 - cut33.ebitda / base.ebitda) / 0.33
  assert.ok(
    amplification > 1.1,
    `a rate cut must hit EBITDA harder than proportionally; amplification ${amplification.toFixed(2)}x`
  )
  assert.ok(cut17.ebitda < base.ebitda * 0.82, 'a 17% rate cut takes a fifth off EBITDA')

  // And "loses money" bites on the DEBT, not on EBITDA: a 33% cut puts the
  // operating company under its 1.30x covenant, which is a default.
  const op33 = computeOperating({ ...reference(), contractRatePerGpuHour: 6.43 * 0.67 })
  assert.ok(
    (op33.dscrYearOne ?? 0) < DSCR_COVENANT,
    `a 33% rate cut breaches the 1.30x covenant: DSCR ${op33.dscrYearOne?.toFixed(2)}x`
  )

  // Revenue is ~92% of EBITDA here, so a rate cut passes almost undamped into
  // the equity line — there is no cost base to absorb it.
  const revenueShare = base.ebitda / (base.rate * 27_072 * 8760)
  assert.ok(revenueShare > 0.8, 'almost no cost base absorbs a rate cut')
})

test('our MOIC is a reconstruction and says so rather than posing as theirs', () => {
  const rs = computeReturns(reference(), {
    equityInvested: TENSORIQ_PUBLISHED.equityRequired,
  })
  assert.ok(
    rs[0].caveats.some((c) => c.includes("reconstruction, not TensorIQ")),
    'the divergence from their published 14.9x must be stated'
  )
  // We reproduce their EXPENSE stack closely; it is the equity base we cannot
  // reproduce. Assert the first so the second is clearly the only gap.
  const op = computeOperating(reference())
  close(op.annualFacilityLease + op.annualPower + op.annualOpex, 260.3 * M, 1, 'total annual expense')
})

test('a DSCR sitting on the covenant floor is reported as an artefact', () => {
  const ref = reference()
  // Tune the rate until year-one DSCR lands on 1.30x, then check it is flagged.
  const op = computeOperating(ref)
  const target =
    DSCR_COVENANT * op.annualDebtService +
    op.annualFacilityLease +
    op.annualPower +
    op.annualOpex
  const rate = target / op.availableGpuHoursPerYear
  const tuned = computeReturns({ ...ref, contractRatePerGpuHour: rate })
  close(tuned[0].dscrYearOne ?? 0, DSCR_COVENANT, 1, 'DSCR tuned to the covenant')
  assert.ok(
    tuned[0].caveats.some((c) => c.includes('covenant floor')),
    'revenue set at the covenant minimum must be called out'
  )
})

test('the residual value swap prices as a put and amortises to a premium', () => {
  const ref = reference()
  const swap = priceResidualSwap({ hardwareCost: ref.hardwareCost, strike: 1.2 * B })
  // Forward = S x e^(-0.19 x 5), a 61% decay over the tenor.
  close(swap.forwardReference, ref.hardwareCost * Math.exp(-0.19 * 5), 0.001, 'forward')
  assert.ok(swap.putValue > 0, 'a put on a decaying asset has value')
  close(swap.annualPremium, swap.putValue / 5, 0.001, 'premium is the put over the tenor')

  // A deeper strike is worth more.
  const deeper = priceResidualSwap({ hardwareCost: ref.hardwareCost, strike: 2 * B })
  assert.ok(deeper.putValue > swap.putValue)
  // Degenerate inputs return zero rather than NaN.
  assert.equal(priceResidualSwap({ hardwareCost: 0, strike: 0 }).putValue, 0)
})

test('the real estate company reproduces its reference figures', () => {
  const ref = reference()
  const re = computeRealEstate(ref.utilityMw, ref.facilityCost)

  close(re.costPerUtilityMw, 10.6 * M, 5, 'about $10.6M per utility MW')
  close(re.noi, 125 * M, 3, 'NOI about $125M')
  close(re.value, 1.57 * B, 3, 'value about $1.57B')
  close(re.unleveredMoic ?? 0, 2.0, 25, 'unlevered multiple on cost')
  // The lease is struck on the whole developed asset; striking it on
  // improvements net of land gives NOI 9% light against the published figure.
  close(re.leaseRevenue, re.totalCost * 0.18, 0.001, 'lease base is total cost')
  // ⚠ LEVERAGE IS EXACTLY MULTIPLE-NEUTRAL HERE, WHICH IS NOT A ROUNDING
  // COINCIDENCE. Construction LTC and permanent LTV are both 65%, so
  // (value − 0.65·value) ÷ (cost − 0.65·cost) reduces to value ÷ cost. The
  // published 5.0x levered against ~2.0x unlevered cannot come from this
  // structure, and that is a question for TensorIQ, not a bug here.
  close(re.leveredMoic ?? 0, re.unleveredMoic ?? 0, 0.01, 'levered equals unlevered by construction')
  assert.ok(re.caveats.some((c) => c.includes('multiple-neutral')))

  // ⚠ The permanent loan exceeds total cost at this cap rate, so the refinance
  // returns all equity and more. That must be surfaced as a cap-rate bet.
  assert.ok(re.permLoan > re.totalCost, 'a $1.02B loan against $784M of cost')
  assert.ok(re.cashOutAtRefinance > 0)
  assert.ok(re.caveats.some((c) => c.includes('returns every dollar of equity')))
  assert.ok(re.caveats.some((c) => c.includes('not TensorIQ')))

  // ⚠ The land is in the RE DevCo cost but excluded from TPC, so this per-MW
  // figure must never be used as a Schedule 1 fee base.
  assert.ok(re.caveats.some((c) => c.includes('not a Schedule 1 fee base')))
})

test("Sterling's $10.5M per MW is the RE DevCo figure, not the facility figure", () => {
  const ref = reference()
  const facility = ref.facilityCost / ref.utilityMw
  const re = computeRealEstate(ref.utilityMw, ref.facilityCost).costPerUtilityMw

  // The facility alone is about $9.6M per utility MW.
  close(facility, 9.6 * M, 2, 'facility only')
  // The RE DevCo, which adds $1M per MW of land, is about $10.6M.
  close(re, 10.6 * M, 5, 'RE DevCo including land')
  // So "~$10.5M per MW" sits with the RE DevCo, land included — and using it as
  // a Cost of the Work base would put excluded land into a Schedule 1 fee base.
  assert.ok(
    Math.abs(re - 10.5 * M) < Math.abs(facility - 10.5 * M),
    "$10.5M/MW is nearer the RE DevCo figure than the facility figure"
  )
})
