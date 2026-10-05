/**
 * The pipeline figure must never be an unlabelled number, and a total that
 * mixes definitions must say so.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mixedTotalNote, pipelineTotal, pipelineValue } from './pipeline'

test('a computed capture figure wins and is labelled as capture', () => {
  const value = pipelineValue({ economics_capture_value: 18_000_000, estimated_value: 150_000_000 })
  assert.equal(value.amount, 18_000_000)
  assert.equal(value.source, 'capture')
  assert.equal(value.definition, 'Ber Wilson capture')
})

test('a hand-entered estimate is used when there is no model, and is labelled as such', () => {
  const value = pipelineValue({ estimated_value: 48_000_000_000 })
  assert.equal(value.amount, 48_000_000_000)
  assert.equal(value.source, 'estimated')
  assert.ok(value.definition.toLowerCase().includes('unmodelled'))
})

test('no figure reads as no figure, never as zero', () => {
  const value = pipelineValue({})
  assert.equal(value.amount, null, 'null, so a tile omits it rather than showing $0')
  assert.equal(value.source, 'none')
  assert.equal(value.definition, 'No value set')
})

test('numeric strings from PostgREST are coerced, not concatenated', () => {
  // `numeric` arrives as a string often enough that this is a real case, and
  // string + number would produce "18000000150000000".
  const value = pipelineValue({ economics_capture_value: '18000000' })
  assert.equal(value.amount, 18_000_000)
})

test('a total made of one kind of figure is consistent and says nothing', () => {
  const total = pipelineTotal([
    { economics_capture_value: 10 },
    { economics_capture_value: 20 },
  ])
  assert.equal(total.amount, 30)
  assert.equal(total.modelled, 2)
  assert.equal(total.consistent, true)
  assert.equal(mixedTotalNote(total), null)
})

test('a total that mixes computed capture with hand estimates announces itself', () => {
  const total = pipelineTotal([
    { economics_capture_value: 18_000_000 },
    { estimated_value: 48_000_000_000 },
    {},
  ])
  assert.equal(total.modelled, 1)
  assert.equal(total.estimated, 1)
  assert.equal(total.unpriced, 1)
  assert.equal(total.consistent, false)
  assert.equal(mixedTotalNote(total), '1 modelled, 1 estimated by hand')
})

test('unpriced records are counted, not silently dropped from the denominator', () => {
  const total = pipelineTotal([{}, {}, { economics_capture_value: 5 }])
  assert.equal(total.amount, 5)
  assert.equal(total.unpriced, 2, 'so a tile can say 1 of 3 deals is priced')
})
