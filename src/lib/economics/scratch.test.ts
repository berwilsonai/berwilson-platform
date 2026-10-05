/**
 * The scratchpad must agree with the deal tab, because it is the same engine.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computeScratch, EMPTY_SCRATCH, scratchFromParams, scratchToParams } from './scratch'

test('MW and one price in $/kWh is the brief’s first acceptance case', () => {
  const { result, ready } = computeScratch({
    ...EMPTY_SCRATCH,
    mw: 10,
    price: 0.08,
    unit: 'per_kwh',
    loadFactor: 0.9,
  })
  assert.equal(ready, true)
  assert.equal(result.lines[0].annualRevenue, 6_307_200, 'the same answer the deal tab gives')
  assert.equal(result.valid, true, 'a scratch model needs no allocation ledger')
})

test('$/kW-month with a PUE is read as IT load and draws facility load', () => {
  const { result, formula } = computeScratch({
    ...EMPTY_SCRATCH,
    mw: 20,
    price: 150,
    unit: 'per_kw_month',
    pue: 1.3,
  })
  assert.equal(result.lines[0].annualRevenue, 36_000_000)
  assert.ok(Math.abs(result.lines[0].facilityMw - 26) < 1e-9, '20 MW IT at PUE 1.30 is 26 MW')
  assert.ok(formula.includes('26 MW on the plant'), formula)
})

test('$/kW-month without a PUE is a capacity charge, not a lease', () => {
  const { result } = computeScratch({
    ...EMPTY_SCRATCH,
    mw: 20,
    price: 150,
    unit: 'per_kw_month',
  })
  assert.equal(result.lines[0].type, 'capacity_charge')
  assert.equal(result.lines[0].annualRevenue, 36_000_000, 'same arithmetic, different contract')
  assert.equal(result.lines[0].facilityMw, 20, 'and it draws the MW entered, not MW x PUE')
})

test('$/MW is a one-time build', () => {
  const { result } = computeScratch({
    ...EMPTY_SCRATCH,
    mw: 10,
    price: 25_000_000,
    unit: 'per_mw',
  })
  assert.equal(result.lines[0].oneTimeValue, 250_000_000)
  assert.equal(result.lines[0].shape, 'one_time')
})

test('a capture percentage makes the line gross and the fee ours', () => {
  const { result } = computeScratch({
    ...EMPTY_SCRATCH,
    mw: 10,
    price: 15_000_000,
    unit: 'per_mw',
    capturePct: 12,
  })
  // $150M build, 12% to us.
  assert.equal(result.tiers.grossGenerated.oneTimeRevenue, 150_000_000)
  assert.equal(result.tiers.berWilsonGross.oneTimeRevenue, 18_000_000)
  // ⚠ And the gross is NOT $168M: the fee is carved out of the contract.
  assert.notEqual(result.tiers.grossGenerated.oneTimeRevenue, 168_000_000)
})

test('nothing entered is not ready and computes no figure', () => {
  const { result, ready } = computeScratch(EMPTY_SCRATCH)
  assert.equal(ready, false)
  assert.equal(result.tiers.berWilsonGross.annualRecurringRevenue, null, 'null, not 0')
})

test('a term and escalator give a contract value and an NPV', () => {
  const { result } = computeScratch({
    ...EMPTY_SCRATCH,
    mw: 10,
    price: 0.08,
    loadFactor: 0.9,
    termYears: 20,
    escalatorPct: 2.5,
    discountRatePct: 9,
  })
  const line = result.lines[0]
  assert.ok((line.contractValue ?? 0) > 6_307_200 * 20, 'escalation lifts it above flat')
  assert.ok(line.npv != null && line.npv < (line.contractValue ?? 0))
})

test('the whole scratch state survives a URL round trip', () => {
  const input = {
    ...EMPTY_SCRATCH,
    mw: 42.5,
    price: 0.0825,
    unit: 'per_kw_month' as const,
    loadFactor: 0.87,
    pue: 1.25,
    termYears: 15,
    escalatorPct: 3,
    discountRatePct: 9.5,
    capturePct: 12.5,
  }
  const back = scratchFromParams(scratchToParams(input))
  assert.deepEqual(back, input, 'a number run on a call is a link someone else can open')
})

test('an empty or junk URL yields the empty state rather than throwing', () => {
  assert.deepEqual(scratchFromParams(new URLSearchParams()), EMPTY_SCRATCH)
  const junk = scratchFromParams(new URLSearchParams('u=nonsense&mw=abc&p='))
  assert.equal(junk.unit, 'per_kwh', 'falls back to a real unit')
  assert.equal(junk.mw, null, 'unparseable means absent, never 0')
})

test('params omit what is unset, so a shared link is short and honest', () => {
  const params = scratchToParams({ ...EMPTY_SCRATCH, mw: 10, price: 0.08 })
  assert.equal(params.get('mw'), '10')
  assert.equal(params.has('lf'), false, 'an unset load factor is absent, not lf=0')
  assert.equal(params.has('cap'), false)
})
