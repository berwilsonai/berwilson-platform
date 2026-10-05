/**
 * The whitelist is a security boundary, so it is tested like one.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { COLLECTIONS, getCollection, normalizeCollectionPayload } from './collections'

const lines = COLLECTIONS.lines

test('a field not in the whitelist never reaches the payload', () => {
  const result = normalizeCollectionPayload(lines, {
    line_type: 'one_time_lump',
    label: 'Build',
    amount: 100,
    // Every one of these would be a real attack if it got through.
    economics_id: 'some-other-deal',
    id: 'forged-id',
    created_at: '1999-01-01',
  })
  assert.ok(result.ok)
  assert.equal('economics_id' in result.value, false, 'cannot move a line to another deal')
  assert.equal('id' in result.value, false, 'cannot forge a row id')
  assert.equal('created_at' in result.value, false, 'cannot restamp when it was created')
})

test('clearing a price sends null, never zero', () => {
  const result = normalizeCollectionPayload(
    lines,
    { price: '', amount: null },
    { partial: true }
  )
  assert.ok(result.ok)
  assert.equal(result.value.price, null)
  assert.equal(result.value.amount, null)
  // ⚠ The whole engine reads null as "nobody has said" and 0 as a real price.
  assert.notEqual(result.value.price, 0)
})

test('a reader can type a figure with dollar signs and commas', () => {
  const result = normalizeCollectionPayload(
    lines,
    { line_type: 'one_time_lump', label: 'Build', amount: '$1,250,000' },
    {}
  )
  assert.ok(result.ok)
  assert.equal(result.value.amount, 1_250_000)
})

test('a value outside the column CHECK is refused with a sentence, not a 23514', () => {
  const result = normalizeCollectionPayload(lines, {
    line_type: 'crypto_mining',
    label: 'Nope',
  })
  assert.ok(!result.ok)
  assert.ok(result.error.includes('line_type'), result.error)
  assert.ok(result.error.includes('energy_sale'), 'the error lists what IS allowed')
})

test('a partial patch touches only the keys present', () => {
  const result = normalizeCollectionPayload(lines, { price: '0.09' }, { partial: true })
  assert.ok(result.ok)
  assert.deepEqual(Object.keys(result.value), ['price'])
  // Required fields are not demanded on a patch, or editing one price would
  // mean resending the whole line.
})

test('a full insert demands its required fields', () => {
  const missingLabel = normalizeCollectionPayload(lines, { line_type: 'one_time_lump' })
  assert.ok(!missingLabel.ok)
  assert.ok(missingLabel.error.includes('label'))
})

test('a malformed number is refused rather than coerced to zero', () => {
  const result = normalizeCollectionPayload(lines, { mw: 'about forty' }, { partial: true })
  assert.ok(!result.ok)
  assert.ok(result.error.includes('mw'), result.error)
})

test('a non-uuid in a uuid field is refused', () => {
  const result = normalizeCollectionPayload(lines, { spv_id: 'not-a-uuid' }, { partial: true })
  assert.ok(!result.ok)
})

test('a ramp arrives as an array of numbers or not at all', () => {
  const good = normalizeCollectionPayload(lines, { ramp: [0.2, '0.6', 1] }, { partial: true })
  assert.ok(good.ok)
  assert.deepEqual(good.value.ramp, [0.2, 0.6, 1])

  const bad = normalizeCollectionPayload(lines, { ramp: ['soon'] }, { partial: true })
  assert.ok(!bad.ok)
})

test('a date must be YYYY-MM-DD', () => {
  const spec = COLLECTIONS.provenance
  const good = normalizeCollectionPayload(spec, { field_key: 'price', as_of: '2026-03-01' })
  assert.ok(good.ok)
  const bad = normalizeCollectionPayload(spec, { field_key: 'price', as_of: '03/01/2026' })
  assert.ok(!bad.ok)
})

test('an SPV ownership split can be cleared back to undetermined', () => {
  const result = normalizeCollectionPayload(
    COLLECTIONS.spvs,
    { bw_ownership_pct: '' },
    { partial: true }
  )
  assert.ok(result.ok)
  // ⚠ Null, not 0. A cleared split means "not yet determined", and 0 would
  // mean Ber Wilson owns none of the vehicle, which is a different claim.
  assert.equal(result.value.bw_ownership_pct, null)
})

test('getCollection is prototype-pollution safe', () => {
  assert.equal(getCollection('lines')?.table, 'economics_lines')
  assert.equal(getCollection('__proto__'), null)
  assert.equal(getCollection('constructor'), null)
  assert.equal(getCollection('toString'), null)
})

test('every collection names a table and orders by a field it has', () => {
  for (const [name, spec] of Object.entries(COLLECTIONS)) {
    assert.ok(spec.table.startsWith('economics_'), `${name} points at ${spec.table}`)
    const known = new Set([...Object.keys(spec.fields), 'id', 'created_at'])
    assert.ok(
      known.has(spec.orderBy.column),
      `${name} orders by ${spec.orderBy.column}, which is not one of its fields`
    )
    for (const field of spec.required) {
      assert.ok(field in spec.fields, `${name} requires ${field}, which is not in its whitelist`)
    }
    for (const field of Object.keys(spec.enums ?? {})) {
      assert.ok(field in spec.fields, `${name} constrains ${field}, which is not in its whitelist`)
    }
  }
})
