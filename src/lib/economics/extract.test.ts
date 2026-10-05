/**
 * The screen between what a model says and what reaches a human.
 *
 * A proposal queue full of figures nobody can check is a queue nobody opens,
 * which costs more than the figures are worth. These are the rules that keep
 * it short.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { screenExtraction } from './extract'

const GOOD_QUOTE = 'Tenant shall pay $145.00 per kW per month of critical IT load.'

test('a figure with a quote, a field and a line type is staged', () => {
  const { accepted, discarded } = screenExtraction({
    figures: [
      {
        field: 'rate_per_kw_month',
        line_type: 'dc_lease',
        label: 'Turnkey lease rate',
        value: 145,
        unit: '$/kW-month',
        basis: 'loi_term_sheet',
        quote: GOOD_QUOTE,
        confidence: 0.9,
      },
    ],
  })
  assert.equal(discarded, 0)
  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].figure.value, 145)
  assert.equal(accepted[0].figure.basis, 'loi_term_sheet')
})

test('a cross-reference is not a quote and is discarded', () => {
  // ⚠ Each of these passed an earlier length-only check. "see above" is nine
  // characters and told the reader nothing, which defeats the one thing this
  // screen exists for. None carries the figure and none is a clause.
  for (const quote of ['see above', 'as noted', 'ibid.', 'see table 3', 'see item 1']) {
    const { accepted, discardedReasons } = screenExtraction({
      figures: [{ field: 'rate_per_kw_month', line_type: 'dc_lease', value: 145, quote }],
    })
    assert.equal(accepted.length, 0, `"${quote}" should not count as a quote`)
    assert.ok(
      Object.keys(discardedReasons).some((r) => r.includes('quote')),
      JSON.stringify(discardedReasons)
    )
  }
})

test('a SHORT quote is kept when it carries the figure, which is the real corpus case', () => {
  // ⚠ These four are verbatim from a live run against the GridEdge customer
  // engagement deck. A word-count floor of five discarded every one of them,
  // and every one is correct and checkable. This is the test that stops the
  // filter being made clever again.
  const cases: [string, number, string][] = [
    ['20MW System', 20, 'it_mw'],
    ['PUE guarantee (1.18)', 1.18, 'pue'],
    ['5-10-year initial term', 5, 'term_years'],
    ['$50-100K assessment fee', 50000, 'amount'],
  ]
  for (const [quote, value, field] of cases) {
    const { accepted } = screenExtraction({
      figures: [{ field, line_type: field === 'amount' ? 'one_time_lump' : 'dc_lease', value, quote }],
    })
    assert.equal(accepted.length, 1, `"${quote}" carries ${value} and must be kept`)
  }
})

test('a clause with no digits is kept, because a figure can be spelled out', () => {
  const { accepted } = screenExtraction({
    figures: [
      {
        field: 'amount',
        line_type: 'one_time_lump',
        value: 1_250_000,
        quote: 'The connection fee is one million two hundred fifty thousand dollars.',
      },
    ],
  })
  assert.equal(accepted.length, 1)
})

test('a field the engine has no column for is discarded AND named', () => {
  const { accepted, discardedReasons } = screenExtraction({
    figures: [
      {
        field: 'carbon_credits_per_tonne',
        line_type: 'dc_lease',
        value: 40,
        quote: GOOD_QUOTE,
      },
    ],
  })
  assert.equal(accepted.length, 0)
  // Named, not lumped: a model repeatedly naming the same missing field is a
  // signal the engine is short a line type, not that the model is wrong.
  assert.ok(
    Object.keys(discardedReasons).some((r) => r.includes('carbon_credits_per_tonne')),
    JSON.stringify(discardedReasons)
  )
})

test('an unrecognised line type is discarded: the figure has nowhere to go', () => {
  const { accepted } = screenExtraction({
    figures: [
      { field: 'mw', line_type: 'crypto_mining', value: 50, quote: GOOD_QUOTE },
    ],
  })
  assert.equal(accepted.length, 0)
})

test('an invented basis falls back to the weakest, never the strongest', () => {
  const { accepted } = screenExtraction({
    figures: [
      {
        field: 'mw',
        line_type: 'dc_lease',
        value: 50,
        quote: GOOD_QUOTE,
        basis: 'definitely_signed',
      },
    ],
  })
  assert.equal(accepted[0].figure.basis, 'planning_assumption')
})

test('a range proposes its low end and SAYS it is a range', () => {
  const { accepted } = screenExtraction({
    figures: [
      {
        field: 'price_per_mw',
        line_type: 'one_time_per_mw',
        value: null,
        value_low: 15_000_000,
        value_high: 20_000_000,
        quote: 'Internals are budgeted at $3B to $4B per 200 MW.',
      },
    ],
  })
  assert.equal(accepted[0].figure.value, 15_000_000, 'the low end, not an invented midpoint')
  assert.ok(accepted[0].figure.reasoning?.includes('range'), accepted[0].figure.reasoning ?? '')
})

test('an uncertain unit is staged WITH a warning rather than dropped', () => {
  const { accepted } = screenExtraction({
    figures: [
      {
        field: 'rate_per_kw_month',
        line_type: 'dc_lease',
        value: 1800,
        unit_uncertain: true,
        quote: 'Rent of $1,800 per kW.',
      },
    ],
  })
  assert.equal(accepted.length, 1, 'the reader decides; dropping it hides the question')
  assert.ok(accepted[0].figure.reasoning?.includes('unit'), accepted[0].figure.reasoning ?? '')
})

test("a partner's revenue is staged and flagged as theirs", () => {
  const { accepted } = screenExtraction({
    figures: [
      {
        field: 'price_per_mw',
        line_type: 'one_time_per_mw',
        value: 17_500_000,
        is_ber_wilson_revenue: false,
        counterparty: 'Elite Solutions',
        quote: 'Elite Solutions shall furnish the internals package at $17.5M per MW.',
      },
    ],
  })
  assert.ok(accepted[0].figure.reasoning?.includes('Elite Solutions'), accepted[0].figure.reasoning ?? '')
})

test('a figure written as a string with a dollar sign is still read', () => {
  const { accepted } = screenExtraction({
    figures: [
      {
        field: 'amount',
        line_type: 'one_time_lump',
        value: '$1,250,000',
        quote: 'The connection fee is one million two hundred fifty thousand dollars.',
      },
    ],
  })
  assert.equal(accepted[0].figure.value, 1_250_000)
})

test('deal-level fields are screened against their own shorter list', () => {
  const { accepted, discardedReasons } = screenExtraction({
    deal_level: [
      { field: 'cap_rate_pct', value: 6.3, quote: 'Capitalized at a 6.3% rate.' },
      { field: 'mw', value: 50, quote: 'The site delivers 50 MW.' },
    ],
  })
  assert.equal(accepted.length, 1, 'cap_rate_pct is deal level; mw is not')
  assert.equal(accepted[0].figure.field, 'cap_rate_pct')
  assert.ok(Object.keys(discardedReasons).some((r) => r.includes('mw')))
})

test('a malformed payload is screened to nothing rather than throwing', () => {
  const { accepted, discarded } = screenExtraction({})
  assert.equal(accepted.length, 0)
  assert.equal(discarded, 0)

  // A model that returns an object where an array belongs must not crash a pass.
  const junk = screenExtraction({ figures: 'nope' as unknown as [] })
  assert.equal(junk.accepted.length, 0)
})
