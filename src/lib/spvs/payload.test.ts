/**
 * The whitelist is a security boundary, so it is tested like one.
 *
 * ⚠ PORTED FROM src/lib/economics/collections.test.ts WHEN THE CALCULATOR WAS
 * REMOVED (2026-10-23). Every one of its eleven subjects is kept. The ones that
 * named a revenue line now run against the vehicle and participant specs or
 * against a spec declared here, because what they were ever testing is the
 * COERCION — "absent is not zero", "a reader may type $1,250,000", "a value
 * outside the CHECK is refused with a sentence" — and none of that was
 * arithmetic. Deleting the engine's test file without moving these would have
 * left the normalizer that survived with no test at all.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PARTICIPANT_SPEC, SPV_SPEC, normalizeParticipant, normalizeSpv } from './collections'
import { normalizeCollectionPayload, type CollectionSpec } from './payload'

/**
 * A spec declared for the test, covering the two field kinds no live spec
 * exercises.
 *
 * ⚠ KEPT RATHER THAN DROPPED WITH THE ENGINE. `numarray` and `date` are real
 * branches in `coerce()`; an untested branch is the one that is wrong when
 * something finally uses it, and the Excel model coming back is exactly that
 * moment. A literal in a test that also exists in source would be a duplicate
 * (§12) — this one exists nowhere else, so it is a fixture.
 */
const KINDS: CollectionSpec = {
  table: 'test_kinds',
  label: 'row',
  fields: { field_key: 'text', as_of: 'date', ramp: 'numarray', count: 'int', flag: 'bool' },
  required: ['field_key'],
  orderBy: { column: 'field_key', ascending: true },
}

test('a field not in the whitelist never reaches the payload', () => {
  const result = normalizeSpv({
    label: 'Delta Land LLC',
    purpose: 'land',
    // Every one of these would be a real attack if it got through.
    project_id: 'some-other-deal',
    opportunity_id: 'some-other-deal',
    id: 'forged-id',
    created_at: '1999-01-01',
    org_node_name: 'Ber Wilson Corporation',
  })
  assert.ok(result.ok)
  assert.equal('project_id' in result.value, false, 'cannot move a vehicle to another deal')
  assert.equal('opportunity_id' in result.value, false, 'nor to another opportunity')
  assert.equal('id' in result.value, false, 'cannot forge a row id')
  assert.equal('created_at' in result.value, false, 'cannot restamp when it was created')
  assert.equal(
    'org_node_name' in result.value,
    false,
    'the snapshot is resolved by the route, or a vehicle could claim to be an entity it is not'
  )
})

test('a participant cannot be moved into another vehicle by its body', () => {
  const result = normalizeParticipant({ holder_name: 'Someone', spv_id: 'another-vehicle' })
  assert.ok(result.ok)
  assert.equal('spv_id' in result.value, false)
})

test('clearing a figure sends null, never zero', () => {
  const result = normalizeParticipant(
    { equity_pct: '', capital_committed: null },
    { partial: true }
  )
  assert.ok(result.ok)
  assert.equal(result.value.equity_pct, null)
  assert.equal(result.value.capital_committed, null)
  // ⚠ An undecided equity split and a 0% one are different facts about a deal,
  // and so are $0 committed and nobody having said.
  assert.notEqual(result.value.equity_pct, 0)
  assert.notEqual(result.value.capital_committed, 0)
})

test('a reader can type a figure with dollar signs and commas', () => {
  const result = normalizeParticipant({
    holder_name: 'Capital partner',
    capital_committed: '$1,250,000',
  })
  assert.ok(result.ok)
  assert.equal(result.value.capital_committed, 1_250_000)
})

test('a value outside the column CHECK is refused with a sentence, not a 23514', () => {
  const result = normalizeSpv({ label: 'Nope', purpose: 'crypto_mining' })
  assert.ok(!result.ok)
  assert.ok(result.error.includes('purpose'), result.error)
  assert.ok(result.error.includes('data_center'), 'the error lists what IS allowed')
})

test('a partial patch touches only the keys present', () => {
  const result = normalizeSpv({ raise_target: '2500000' }, { partial: true })
  assert.ok(result.ok)
  assert.deepEqual(Object.keys(result.value), ['raise_target'])
  // Required fields are not demanded on a patch, or editing one figure would
  // mean resending the whole row.
})

test('a full insert demands its required fields', () => {
  const missingLabel = normalizeSpv({ purpose: 'land' })
  assert.ok(!missingLabel.ok)
  assert.ok(missingLabel.error.includes('label'))

  const missingHolder = normalizeParticipant({ role: 'sponsor' })
  assert.ok(!missingHolder.ok)
  assert.ok(missingHolder.error.includes('holder_name'))
})

test('a malformed number is refused rather than coerced to zero', () => {
  const result = normalizeParticipant({ equity_pct: 'about forty' }, { partial: true })
  assert.ok(!result.ok)
  assert.ok(result.error.includes('equity_pct'), result.error)
})

test('a non-uuid in a uuid field is refused', () => {
  const result = normalizeSpv({ entity_id: 'not-a-uuid' }, { partial: true })
  assert.ok(!result.ok)
})

test('a numeric array arrives as numbers or not at all', () => {
  const good = normalizeCollectionPayload(KINDS, { ramp: [0.2, '0.6', 1] }, { partial: true })
  assert.ok(good.ok)
  assert.deepEqual(good.value.ramp, [0.2, 0.6, 1])

  const bad = normalizeCollectionPayload(KINDS, { ramp: ['soon'] }, { partial: true })
  assert.ok(!bad.ok)
})

test('a date must be YYYY-MM-DD', () => {
  const good = normalizeCollectionPayload(KINDS, { field_key: 'price', as_of: '2026-03-01' })
  assert.ok(good.ok)
  const bad = normalizeCollectionPayload(KINDS, { field_key: 'price', as_of: '03/01/2026' })
  assert.ok(!bad.ok)
})

test('an int is truncated, and a bool accepts the string a form sends', () => {
  const result = normalizeCollectionPayload(
    KINDS,
    { count: '3.7', flag: 'true' },
    { partial: true }
  )
  assert.ok(result.ok)
  assert.equal(result.value.count, 3)
  assert.equal(result.value.flag, true)
})

test('every live spec orders by a field it has and requires only fields it whitelists', () => {
  for (const [name, spec] of Object.entries({ vehicle: SPV_SPEC, participant: PARTICIPANT_SPEC })) {
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
    // ⚠ The parent pointers must be absent from every whitelist, or a body
    // could re-parent the row onto a record it may write (§12).
    for (const forbidden of ['id', 'project_id', 'opportunity_id', 'spv_id', 'created_at', 'updated_at']) {
      assert.equal(forbidden in spec.fields, false, `${name} whitelists ${forbidden}`)
    }
  }
})
