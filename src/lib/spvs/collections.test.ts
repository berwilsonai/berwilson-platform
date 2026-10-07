/**
 * The vehicle and participant whitelists.
 *
 * The coercion itself is `normalizeCollectionPayload`, tested in
 * src/lib/economics/collections.test.ts. What is tested here is the part that
 * is specific to these two specs: what they let through, what they refuse, and
 * that clearing a figure means "undetermined" rather than zero.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  explainSpvError,
  normalizeParticipant,
  normalizeSpv,
  PARTICIPANT_SPEC,
  SPV_SPEC,
} from './collections'

test('a vehicle ownership split can be cleared back to undetermined', () => {
  const result = normalizeSpv({ bw_ownership_pct: '' }, { partial: true })
  assert.ok(result.ok)
  // ⚠ Null, not 0. A cleared split means "not yet determined", and 0 would mean
  // Ber Wilson owns none of the vehicle, which is a different claim.
  assert.equal(result.value.bw_ownership_pct, null)
})

test('a participant equity split can be cleared back to undetermined', () => {
  const result = normalizeParticipant({ equity_pct: '' }, { partial: true })
  assert.ok(result.ok)
  assert.equal(result.value.equity_pct, null)
})

test('clearing a capital figure means nobody has said, not $0', () => {
  const result = normalizeParticipant(
    { capital_committed: '', capital_funded: '' },
    { partial: true }
  )
  assert.ok(result.ok)
  assert.equal(result.value.capital_committed, null)
  assert.equal(result.value.capital_funded, null)
})

test('a reader can type a money figure with commas', () => {
  const result = normalizeParticipant(
    { holder_name: 'Avant Capital', capital_committed: '14,000,000' },
    {}
  )
  assert.ok(result.ok)
  assert.equal(result.value.capital_committed, 14_000_000)
})

test('a vehicle needs a name', () => {
  assert.ok(!normalizeSpv({ purpose: 'energy' }).ok)
  assert.ok(normalizeSpv({ label: 'Myton Energy LLC', purpose: 'energy' }).ok)
})

test('a participant needs a name — the link to a record is optional', () => {
  assert.ok(!normalizeParticipant({ equity_pct: 35 }).ok)
  assert.ok(normalizeParticipant({ holder_name: 'Avant Capital' }).ok)
})

test('an unknown purpose or role is refused at the edge, with the list', () => {
  const purpose = normalizeSpv({ label: 'X', purpose: 'datacenter' })
  assert.ok(!purpose.ok)
  assert.match(purpose.error, /must be one of/)
  assert.ok(!normalizeParticipant({ holder_name: 'X', role: 'investor' }).ok)
  assert.ok(!normalizeParticipant({ holder_name: 'X', class: 'equity' }).ok)
})

test('the Ber Wilson flag survives as a real boolean', () => {
  const on = normalizeParticipant({ holder_name: 'Ber Wilson', is_ber_wilson: true })
  assert.ok(on.ok)
  assert.equal(on.value.is_ber_wilson, true)
  const off = normalizeParticipant({ holder_name: 'Avant', is_ber_wilson: false })
  assert.ok(off.ok)
  assert.equal(off.value.is_ber_wilson, false)
})

// ── the whitelist is a security boundary ───────────────────────────────────

test('nothing outside the whitelist reaches the database', () => {
  const result = normalizeSpv({
    label: 'Myton Energy LLC',
    // Each of these would let a crafted body move the row to another deal,
    // forge its identity, or restamp when it was created.
    project_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    opportunity_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    created_at: '2020-01-01',
    updated_at: '2020-01-01',
  })
  assert.ok(result.ok)
  for (const key of Object.keys(result.value)) {
    assert.ok(key in SPV_SPEC.fields, `${key} reached the database un-whitelisted`)
  }
  assert.deepEqual(Object.keys(result.value), ['label'])
})

test('a column the body never mentioned is OMITTED, so its default applies', () => {
  const result = normalizeSpv({ label: 'Myton Energy LLC' })
  assert.ok(result.ok)
  // ⚠ NOT `status: null`. `status`, `purpose` and `sort_order` are NOT NULL
  // with defaults, and an explicit NULL does not fall back to a default — it
  // violates the constraint. This exact shape answered *null value in column
  // "status" … violates not-null constraint* on every create.
  assert.ok(!('status' in result.value))
  assert.ok(!('purpose' in result.value))
  assert.ok(!('sort_order' in result.value))
})

test('a required field is still required once absent fields are omitted', () => {
  assert.ok(!normalizeSpv({ purpose: 'energy' }).ok)
  assert.ok(!normalizeParticipant({ equity_pct: 40 }).ok)
})

test('a field explicitly cleared to empty DOES send null', () => {
  // The distinction the omission rule turns on: "not mentioned" means the
  // default, "mentioned as empty" means the reader cleared it.
  const result = normalizeSpv({ label: 'X', jurisdiction: '' })
  assert.ok(result.ok)
  assert.equal(result.value.jurisdiction, null)
  assert.ok('jurisdiction' in result.value)
})

test('a participant body cannot name its own vehicle', () => {
  const result = normalizeParticipant({
    holder_name: 'Avant Capital',
    spv_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  })
  assert.ok(result.ok)
  // `spv_id` comes from the path the access guard resolved, never from here.
  assert.ok(!('spv_id' in result.value))
})

test('`org_node_name` is not settable — the route resolves the snapshot', () => {
  assert.ok(!('org_node_name' in SPV_SPEC.fields))
  const result = normalizeSpv({ label: 'X', org_node_name: 'Ber Wilson, Inc.' })
  assert.ok(result.ok)
  assert.ok(!('org_node_name' in result.value))
})

test('neither spec exposes a parent key or a timestamp', () => {
  for (const spec of [SPV_SPEC, PARTICIPANT_SPEC]) {
    for (const forbidden of ['id', 'created_at', 'updated_at', 'project_id', 'opportunity_id', 'spv_id']) {
      assert.ok(!(forbidden in spec.fields), `${spec.table} must not whitelist ${forbidden}`)
    }
  }
})

// ── errors name the fix ────────────────────────────────────────────────────

test('a duplicate vehicle name explains why names are unique', () => {
  const message = explainSpvError(
    'duplicate key value violates unique constraint "project_spvs_label_unique"',
    '23505'
  )
  assert.match(message, /already has a vehicle with that name/)
})

test('a second Ber Wilson row says our share is read from one row', () => {
  const message = explainSpvError(
    'duplicate key value violates unique constraint "uniq_spv_participants_bw"',
    '23505'
  )
  assert.match(message, /only be one/)
})

test('a percentage out of range says empty is not zero', () => {
  const message = explainSpvError(
    'new row violates check constraint "project_spv_participants_equity_pct_check"',
    '23514'
  )
  assert.match(message, /between 0 and 100/)
  assert.match(message, /different from zero/)
})

test('an unrecognised error is passed through rather than being guessed at', () => {
  assert.equal(explainSpvError('something nobody has seen', '99999'), 'something nobody has seen')
})
