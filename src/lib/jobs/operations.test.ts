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

/** One fixture per operation kind. The coverage test below reads this too. */
const DESCRIBE_SAMPLES: unknown[] = [
    { kind: 'update_field', table: 'projects', record_id: UUID_A, field: 'location', value: 'Tooele, UT', record_label: 'Tooele' },
    { kind: 'create_contact', full_name: 'A B', title: 'CRO', company: 'Acme' },
    { kind: 'create_task', title: 'Call the recorder', due_date: '2026-11-04' },
    { kind: 'add_note', target: 'party', record_id: UUID_A, body: 'Met at the delegation dinner.' },
    { kind: 'tag_records', table: 'parties', record_ids: [UUID_A, UUID_B], add: ['reviewed'], remove: ['stale'] },
    { kind: 'link_thread', thread_id: UUID_A, record_kind: 'project', record_id: UUID_B, record_label: 'Whiskey (TX)', evidence: 'Executed PSA from the seller’s counsel.' },
    { kind: 'add_player', party_id: UUID_A, record_kind: 'project', record_id: UUID_B, record_label: 'Whiskey (TX)', party_label: 'Taylor Englert', role: 'Seller' },
    { kind: 'create_record', record_kind: 'opportunity', name: 'Zorro (TX)', location: 'Texas', evidence: 'Signed LOI and a dated site visit.' },
]

test('every kind describes itself without NaN, undefined or [object Object]', () => {
  const samples = DESCRIBE_SAMPLES
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

test('every kind in the vocabulary has a sample, a validator and a describe line', () => {
  /*
    ⚠ THIS ASSERTED `OPERATION_KINDS.length === 5` AND THAT IS THE WRONG SHAPE.
    §12: a test that hardcodes the value it verifies is testing the COPY. It
    could only ever say "the number changed", which the author already knows,
    and the way to make it pass was to edit the number — so adding a kind with
    no describe branch and no sample would have been one keystroke from green.

    Derived instead: the sample set above must COVER the vocabulary, so a verb
    added to `OPERATION_KINDS` with no fixture fails here by name, and
    `describeOperation`'s exhaustive switch fails at compile time. Together they
    are the ratchet the magic number was pretending to be.
  */
  const covered = new Set(DESCRIBE_SAMPLES.map((raw) => (raw as { kind: string }).kind))
  const missing = OPERATION_KINDS.filter((k) => !covered.has(k))
  assert.deepEqual(missing, [], `no describe fixture for: ${missing.join(', ')}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// The three filing verbs (2026-10-29).
//
// ⚠ THESE EXIST BECAUSE THE VERBS WERE ADDED TO LET A JOB WORK A BACKLOG OF
// 1,823 UNFILED THREADS, and the failure mode of that work is not a crash — it
// is a plausible edit that lands on sixty rows and is noticed six weeks later,
// which is the exact hazard `operations.ts` opens by naming. So the assertions
// below are mostly about what the validator REFUSES.
// ─────────────────────────────────────────────────────────────────────────────

test('link_thread needs both uuids and a record kind the schema can take', () => {
  const ok = validateOperation({
    kind: 'link_thread', thread_id: UUID_A, record_kind: 'project',
    record_id: UUID_B, evidence: 'Executed PSA for the site, from the seller’s counsel.',
  })
  assert.equal(typeof ok === 'string' ? ok : ok.kind, 'link_thread')

  // A steel deal is a destination two of the three verbs cannot reach.
  assert.equal(typeof validateOperation({
    kind: 'link_thread', thread_id: UUID_A, record_kind: 'steel_deal',
    record_id: UUID_B, evidence: 'x',
  }), 'string')
  // A name where an id belongs — the commonest model slip.
  assert.equal(typeof validateOperation({
    kind: 'link_thread', thread_id: 'Whiskey', record_kind: 'project',
    record_id: UUID_B, evidence: 'x',
  }), 'string')
})

test('link_thread REFUSES a proposal with no evidence', () => {
  // ⚠ Evidence is required here where it is optional on update_field. The
  // reviewer presses on one line, and filing onto the wrong deal answers for
  // that deal until somebody notices — so a proposal that cannot say why is
  // not a proposal.
  const r = validateOperation({
    kind: 'link_thread', thread_id: UUID_A, record_kind: 'project', record_id: UUID_B,
  })
  assert.equal(typeof r, 'string')
  assert.match(r as string, /evidence/)
  assert.equal(typeof validateOperation({
    kind: 'link_thread', thread_id: UUID_A, record_kind: 'project', record_id: UUID_B, evidence: '   ',
  }), 'string')
})

test('add_player carries the prose role through and tolerates its absence', () => {
  const r = validateOperation({
    kind: 'add_player', party_id: UUID_A, record_kind: 'opportunity',
    record_id: UUID_B, role: 'Seller’s counsel',
  })
  assert.notEqual(typeof r, 'string')
  assert.equal((r as { role: string | null }).role, 'Seller’s counsel')
  const bare = validateOperation({
    kind: 'add_player', party_id: UUID_A, record_kind: 'project', record_id: UUID_B,
  })
  // No role is legal — the write defaults it. A guess would be worse.
  assert.notEqual(typeof bare, 'string')
  assert.equal((bare as { role: string | null }).role, null)
})

test('create_record refuses an abbreviation, a missing name and missing evidence', () => {
  assert.equal(typeof validateOperation({ kind: 'create_record', record_kind: 'project', name: 'XY', evidence: 'x' }), 'string')
  assert.equal(typeof validateOperation({ kind: 'create_record', record_kind: 'project', evidence: 'x' }), 'string')
  assert.equal(typeof validateOperation({ kind: 'create_record', record_kind: 'project', name: 'Whiskey (TX)' }), 'string')
  const ok = validateOperation({
    kind: 'create_record', record_kind: 'project', name: 'Whiskey (TX)',
    evidence: 'Signed LOI and a dated site visit in correspondence.',
  })
  assert.equal(typeof ok === 'string' ? ok : ok.kind, 'create_record')
})

test('create_record never carries a negative or non-numeric value', () => {
  // §12: a money figure must carry its shape, and a rolled-up sum with nothing
  // in it is NULL rather than 0.
  const neg = validateOperation({
    kind: 'create_record', record_kind: 'project', name: 'Something Real', evidence: 'e', estimated_value: -5,
  })
  assert.equal((neg as { estimated_value: number | null }).estimated_value, null)
  const txt = validateOperation({
    kind: 'create_record', record_kind: 'project', name: 'Something Real', evidence: 'e', estimated_value: '12m',
  })
  assert.equal((txt as { estimated_value: number | null }).estimated_value, null)
})

test('every new verb is in OPERATION_KINDS, or the model is never told it exists', () => {
  // ⚠ The declaration the model reads is built from this list (run.ts), and the
  // validator refuses any kind not on it. A verb implemented but left off the
  // list is a verb that can never fire — the §12 shape where a curated
  // vocabulary only one caller reads is decoration.
  for (const k of ['link_thread', 'add_player', 'create_record']) {
    assert.ok(OPERATION_KINDS.includes(k as never), `${k} missing from OPERATION_KINDS`)
  }
})

test('describeOperation gives every kind a line a reviewer can read', () => {
  // A row with no sentence is a row nobody can press — and the switch is
  // exhaustive, so a kind added without a description fails to compile. This
  // asserts the SENTENCE is useful, which tsc cannot.
  const lines = [
    describeOperation({ kind: 'link_thread', thread_id: UUID_A, record_kind: 'project', record_id: UUID_B, record_label: 'Whiskey (TX)', evidence: 'Executed PSA' }),
    describeOperation({ kind: 'add_player', party_id: UUID_A, record_kind: 'project', record_id: UUID_B, record_label: 'Whiskey (TX)', party_label: 'Taylor Englert', role: 'Seller' }),
    describeOperation({ kind: 'create_record', record_kind: 'opportunity', name: 'Zorro (TX)', evidence: 'Signed LOI', location: 'Texas' }),
  ]
  for (const l of lines) {
    assert.ok(l.length > 10, `too short: ${l}`)
    assert.ok(!l.includes('undefined'), `leaks undefined: ${l}`)
    assert.ok(!/\[object/.test(l), `leaks an object: ${l}`)
  }
  assert.match(lines[0], /Whiskey \(TX\)/)
  assert.match(lines[1], /Taylor Englert/)
  assert.match(lines[2], /Zorro/)
})
