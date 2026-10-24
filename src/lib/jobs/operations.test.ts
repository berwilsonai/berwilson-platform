/**
 * The job write boundary.
 *
 * This is the file that decides what a capable model is allowed to change when
 * a human presses apply. Every refusal here is a refusal the reviewer will see
 * with a reason, so the tests assert the REASON as well as the rejection — a
 * guard that refuses silently is indistinguishable from one that is broken.
 *
 * ⚠ Several cases plant a violation on purpose (an invented column, a delete
 * verb, SQL in a field name) and prove it still fails, because a static guard
 * that has never been shown to refuse anything is not evidence of anything
 * (§12).
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MAX_OPERATIONS,
  OPERATION_KINDS,
  describeOperation,
  toFieldUpdate,
  validateOperation,
  validateOperations,
  type JobOperation,
} from './operations'

const UUID_A = '11111111-2222-4333-8444-555555555555'
const UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

/** Narrow or fail loudly — a test that silently accepts a string is testing nothing. */
function ok(raw: unknown): JobOperation {
  const r = validateOperation(raw)
  assert.ok(typeof r !== 'string', `expected an operation, got refusal: ${r}`)
  return r
}

function refused(raw: unknown): string {
  const r = validateOperation(raw)
  assert.equal(typeof r, 'string', 'expected a refusal, got an operation')
  return r as string
}

// ── The vocabulary is closed ────────────────────────────────────────────────

test('a kind outside the vocabulary is refused, and the reason names the vocabulary', () => {
  const reason = refused({ kind: 'delete_records', table: 'parties', record_ids: [UUID_A] })
  assert.match(reason, /not an operation this platform performs/)
  for (const k of OPERATION_KINDS) assert.match(reason, new RegExp(k))
})

test('there is no delete verb at all', () => {
  assert.ok(!OPERATION_KINDS.includes('delete' as never))
  for (const kind of ['delete', 'delete_record', 'drop_table', 'run_sql', 'execute']) {
    assert.equal(typeof validateOperation({ kind }), 'string', `${kind} must be refused`)
  }
})

test('a non-object and a missing kind are refused rather than throwing', () => {
  assert.equal(refused(null), 'not an object')
  assert.equal(refused('update_field'), 'not an object')
  assert.equal(refused({}), 'no kind')
})

// ── update_field defers to the provenance registry ──────────────────────────

test('a column absent from the field registry is refused — the model does not choose columns', () => {
  // The exact column that must never be machine-written.
  const reason = refused({
    kind: 'update_field', table: 'projects', record_id: UUID_A,
    field: 'confidential', value: false,
  })
  assert.match(reason, /not a field any automated pass may write/)
})

test('SQL smuggled into a field name is refused by the registry, not by a pattern', () => {
  const reason = refused({
    kind: 'update_field', table: 'projects', record_id: UUID_A,
    field: "name = 'x'; drop table parties; --", value: 1,
  })
  assert.match(reason, /not a field any automated pass may write/)
})

test('update_field needs a uuid record_id', () => {
  assert.match(
    refused({ kind: 'update_field', table: 'projects', record_id: 'all', field: 'location', value: 'UT' }),
    /uuid/
  )
})

test('a registry-listed field is accepted', () => {
  const op = ok({
    kind: 'update_field', table: 'projects', record_id: UUID_A,
    field: 'location', value: 'Tooele, UT', evidence: 'the PSA names the county',
  })
  assert.equal(op.kind, 'update_field')
})

test('fill_only DEFAULTS TO TRUE — a job must argue its way into overwriting', () => {
  const dflt = ok({ kind: 'update_field', table: 'projects', record_id: UUID_A, field: 'location', value: 'UT' })
  assert.equal(dflt.kind === 'update_field' && dflt.fill_only, true)

  // Only an explicit `false` turns it off; a truthy-ish string must not.
  for (const v of ['false', 0, null, undefined]) {
    const op = ok({ kind: 'update_field', table: 'projects', record_id: UUID_A, field: 'location', value: 'UT', fill_only: v })
    assert.equal(op.kind === 'update_field' && op.fill_only, true, `fill_only: ${JSON.stringify(v)} must stay true`)
  }
  const off = ok({ kind: 'update_field', table: 'projects', record_id: UUID_A, field: 'location', value: 'UT', fill_only: false })
  assert.equal(off.kind === 'update_field' && off.fill_only, false)
})

test('the fill-only default survives the trip into the provenance layer', () => {
  const op = ok({ kind: 'update_field', table: 'projects', record_id: UUID_A, field: 'location', value: 'UT' })
  assert.equal(toFieldUpdate(op as Extract<JobOperation, { kind: 'update_field' }>).fillOnly, true)
})

// ── create_contact ──────────────────────────────────────────────────────────

test('a contact needs a name, and an unusable tag is refused by name', () => {
  assert.match(refused({ kind: 'create_contact', full_name: '  ' }), /needs a full_name/)
  const reason = refused({ kind: 'create_contact', full_name: 'A B', tags: ['Flightech Delegation'] })
  assert.match(reason, /not a usable tag/)
  assert.match(reason, /Flightech Delegation/)
})

test('a thing that is not an email address is refused as one', () => {
  assert.match(refused({ kind: 'create_contact', full_name: 'A B', email: 'not-an-address' }), /not an email address/)
})

test('is_organization must be said explicitly — a missing flag is a person', () => {
  const op = ok({ kind: 'create_contact', full_name: 'Acme Steel' })
  assert.equal(op.kind === 'create_contact' && op.is_organization, false)
})

test('a contact cannot smuggle columns the vocabulary does not name', () => {
  const op = ok({
    kind: 'create_contact', full_name: 'A B',
    status: 'archived', merged_into_party_id: UUID_B, confidential: true, id: UUID_A,
  })
  assert.deepEqual(Object.keys(op).sort(), [
    'company', 'email', 'full_name', 'is_organization', 'kind', 'notes', 'phone', 'tags', 'title',
  ])
})

// ── create_task ─────────────────────────────────────────────────────────────

test('a task date must be a date, and the refusal shows what it got', () => {
  const reason = refused({ kind: 'create_task', title: 'T', due_date: 'next Friday' })
  assert.match(reason, /YYYY-MM-DD/)
  assert.match(reason, /next Friday/)
})

test('a task hangs off a project OR an opportunity, never both', () => {
  assert.match(
    refused({ kind: 'create_task', title: 'T', project_id: UUID_A, opportunity_id: UUID_B }),
    /never both/
  )
})

// ── add_note ────────────────────────────────────────────────────────────────

test('a note target outside the three is refused', () => {
  assert.match(refused({ kind: 'add_note', target: 'entity', record_id: UUID_A, body: 'x' }), /target must be one of/)
})

test('an empty note body is refused — an empty note is not a note', () => {
  assert.match(refused({ kind: 'add_note', target: 'party', record_id: UUID_A, body: '   ' }), /needs a body/)
})

// ── tag_records ─────────────────────────────────────────────────────────────

test('tagging needs a real table, real ids and at least one tag', () => {
  // ⚠ `parties` is the ONLY table in the schema with a `tags` column. These two
  // were in the vocabulary until `tsc` refused the executor — a verb the schema
  // cannot perform must not validate.
  for (const table of ['projects', 'opportunities', 'documents']) {
    assert.match(refused({ kind: 'tag_records', table, record_ids: [UUID_A], add: ['x'] }), /must be one of/)
  }
  assert.match(refused({ kind: 'tag_records', table: 'parties', record_ids: ['everyone'], add: ['x'] }), /uuid/)
  assert.match(refused({ kind: 'tag_records', table: 'parties', record_ids: [UUID_A] }), /tags to add or remove/)
})

test('non-uuid ids are dropped rather than taking the whole operation down', () => {
  const op = ok({ kind: 'tag_records', table: 'parties', record_ids: [UUID_A, 'oops', UUID_B], add: ['reviewed'] })
  assert.deepEqual(op.kind === 'tag_records' && op.record_ids, [UUID_A, UUID_B])
})

// ── batches ─────────────────────────────────────────────────────────────────

test('a batch keeps the refusals beside the survivors, so nothing vanishes quietly', () => {
  const { operations, rejected } = validateOperations([
    { kind: 'create_contact', full_name: 'Real Person' },
    { kind: 'delete_records', table: 'parties' },
    { kind: 'update_field', table: 'projects', record_id: UUID_A, field: 'confidential', value: false },
  ])
  assert.equal(operations.length, 1)
  assert.equal(rejected.length, 2)
  assert.ok(rejected.every((r) => r.reason.length > 0))
})

test('a batch over the cap is truncated AND says so — a silent drop is the bug', () => {
  const many = Array.from({ length: MAX_OPERATIONS + 10 }, (_, i) => ({
    kind: 'create_contact', full_name: `Person ${i}`,
  }))
  const { operations, rejected } = validateOperations(many)
  assert.equal(operations.length, MAX_OPERATIONS)
  assert.ok(rejected.some((r) => /is the most one job may carry/.test(r.reason)))
})

test('a non-array batch is empty rather than a throw', () => {
  assert.deepEqual(validateOperations(null), { operations: [], rejected: [] })
  assert.deepEqual(validateOperations({ kind: 'create_contact' }), { operations: [], rejected: [] })
})

// ── the review line ─────────────────────────────────────────────────────────

test('every kind describes itself without NaN, undefined or [object Object]', () => {
  const samples: unknown[] = [
    { kind: 'update_field', table: 'projects', record_id: UUID_A, field: 'location', value: 'Tooele, UT', record_label: 'Tooele' },
    { kind: 'create_contact', full_name: 'A B', title: 'CRO', company: 'Acme' },
    { kind: 'create_task', title: 'Call the recorder', due_date: '2026-11-04' },
    { kind: 'add_note', target: 'party', record_id: UUID_A, body: 'Met at the delegation dinner.' },
    { kind: 'tag_records', table: 'parties', record_ids: [UUID_A, UUID_B], add: ['reviewed'], remove: ['stale'] },
  ]
  const seen = new Set<string>()
  for (const raw of samples) {
    const line = describeOperation(ok(raw))
    assert.ok(line.length > 0)
    for (const bad of ['undefined', 'NaN', '[object Object]', 'null']) {
      assert.ok(!line.includes(bad), `"${line}" leaked ${bad}`)
    }
    seen.add(line)
  }
  // One line per kind — a shared fallthrough would collapse them.
  assert.equal(seen.size, samples.length)
})

test('every kind in the vocabulary has a describe branch', () => {
  // Guards the §12 drift: a new kind added to the union and not to the renderer.
  assert.equal(OPERATION_KINDS.length, 5)
})
