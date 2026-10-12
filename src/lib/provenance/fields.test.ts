/**
 * The autonomy decision table.
 *
 * This is the file that decides, unattended at 4am, whether a model's reading
 * of an email replaces a figure Richard typed. Every branch of `canWrite` has a
 * case here, and the three that matter most are the last three: a guarded field
 * with human provenance, with Pepper's own provenance, and with none at all.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { canWrite, fieldSpec, isBlank, sameValue } from './fields'

test('a field absent from the registry is never writable', () => {
  // The exact column that must never be machine-written.
  assert.equal(fieldSpec('projects', 'confidential'), null)
  const d = canWrite({
    table: 'projects',
    field: 'confidential',
    currentValue: false,
    proposedValue: true,
    writtenBy: 'pepper',
  })
  assert.equal(d.action, 'skip')
  assert.match(d.reason, /not writable/)
})

test('a whole table absent from the registry is never writable', () => {
  const d = canWrite({
    table: 'commitments',
    field: 'what',
    currentValue: 'a',
    proposedValue: 'b',
    writtenBy: null,
  })
  assert.equal(d.action, 'skip')
})

test('filling a blank is always allowed, even on a guarded field', () => {
  // Richard's live open item: three Delta vehicles with a NULL equity_pct.
  // A guard that refused to fill them would make her useless on a new deal.
  const d = canWrite({
    table: 'project_spv_participants',
    field: 'equity_pct',
    currentValue: null,
    proposedValue: 51,
    writtenBy: null,
  })
  assert.equal(d.action, 'write')
  assert.match(d.reason, /blank/)
})

test('an empty string counts as blank but zero and false do not', () => {
  assert.equal(isBlank(''), true)
  assert.equal(isBlank('   '), true)
  assert.equal(isBlank(null), true)
  assert.equal(isBlank(0), false)
  assert.equal(isBlank(false), false)
  // A zero equity_pct is a decision somebody made; it is not an empty box.
  const d = canWrite({
    table: 'project_spv_participants',
    field: 'equity_pct',
    currentValue: 0,
    proposedValue: 51,
    writtenBy: 'human',
  })
  assert.equal(d.action, 'propose')
})

test('she never clears a value', () => {
  for (const proposed of [null, '', '   ', undefined]) {
    const d = canWrite({
      table: 'projects',
      field: 'description',
      currentValue: 'A real description',
      proposedValue: proposed,
      writtenBy: 'pepper',
    })
    assert.equal(d.action, 'skip', `proposed ${JSON.stringify(proposed)}`)
    assert.match(d.reason, /clear/)
  }
})

test('an unchanged value is skipped, never logged as work', () => {
  const d = canWrite({
    table: 'projects',
    field: 'description',
    currentValue: 'Same text',
    proposedValue: 'Same text',
    writtenBy: 'human',
  })
  assert.equal(d.action, 'skip')
  assert.equal(d.reason, 'unchanged')
})

test('an open field is overwritten whoever wrote it', () => {
  const d = canWrite({
    table: 'projects',
    field: 'description',
    currentValue: 'A thin human line',
    proposedValue: 'A fuller description read out of the correspondence',
    writtenBy: 'human',
  })
  assert.equal(d.action, 'write')
})

test('a guarded field a human typed is PROPOSED, never overwritten', () => {
  // Richard's carve-out, verbatim: partner split percentages.
  const d = canWrite({
    table: 'project_spv_participants',
    field: 'equity_pct',
    currentValue: 51,
    proposedValue: 49,
    writtenBy: 'human',
  })
  assert.equal(d.action, 'propose')
  assert.match(d.reason, /human-entered/)
})

test('a guarded field Pepper herself wrote she may revise', () => {
  const d = canWrite({
    table: 'milestones',
    field: 'target_date',
    currentValue: '2026-10-17',
    proposedValue: '2026-11-01',
    writtenBy: 'pepper',
  })
  assert.equal(d.action, 'write')
})

test('a guarded field with NO provenance is treated as human', () => {
  // ⚠ The default that protects every value written before this table existed.
  // Reading absence as "mine" would hand her the whole curated CRM on run one.
  const d = canWrite({
    table: 'projects',
    field: 'bid_due_date',
    currentValue: '2026-10-17',
    proposedValue: '2026-11-01',
    writtenBy: null,
  })
  assert.equal(d.action, 'propose')
  assert.match(d.reason, /unknown provenance/)
})

test('a date is not rewritten because Postgres spelled it differently', () => {
  // The nightly no-op that would otherwise be reported as work every morning.
  assert.equal(sameValue('2026-11-01', '2026-11-01T00:00:00+00:00'), true)
  assert.equal(sameValue('2026-11-01T00:00:00+00:00', '2026-11-01'), true)
  assert.equal(sameValue('2026-11-01', '2026-11-02'), false)
  const d = canWrite({
    table: 'milestones',
    field: 'target_date',
    currentValue: '2026-11-01T00:00:00+00:00',
    proposedValue: '2026-11-01',
    writtenBy: 'human',
  })
  assert.equal(d.action, 'skip')
})

test('numeric precision does not count as a change', () => {
  assert.equal(sameValue('4.69', '4.690'), true)
  assert.equal(sameValue(4.69, '4.69'), true)
  assert.equal(sameValue('4.69', '13.00'), false)
})

test('case-only differences do not count as a change', () => {
  assert.equal(sameValue('Bank of Utah', 'bank of utah'), true)
})
