/**
 * The child registry's invariants, and the coercion it shares with governance.
 *
 * ⚠ THE SPEC IS NOW THE ONLY PLACE SIX TABLES' WRITE RULES ARE WRITTEN, so a
 * typo in it is a silently wrong route rather than a compile error — a column
 * misspelled in `fields` is simply a field no body can ever write, and a column
 * named in `required` but absent from `fields` makes every create fail with
 * "x is required" however the caller fills the form. These assertions are what
 * stands in for the twelve route files' worth of hand-written branches.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { applyStamp, CHILD_PATHS, CHILDREN, getChild } from './children'
import { normalizePayload } from '@/lib/registry/fields'

const SPECS = Object.entries(CHILDREN)

test('a spec can only require, default or constrain a column it also declares', () => {
  for (const [name, spec] of SPECS) {
    for (const column of spec.required) {
      assert.ok(column in spec.fields, `${name}: required column "${column}" is not in fields`)
    }
    for (const column of Object.keys(spec.defaults ?? {})) {
      assert.ok(column in spec.fields, `${name}: default for "${column}" is not in fields`)
    }
    for (const column of Object.keys(spec.enums ?? {})) {
      assert.ok(column in spec.fields, `${name}: enum for "${column}" is not in fields`)
    }
  }
})

test('no spec lets a body name its own parent', () => {
  // The whole point of reading the parent off the ROW on a PATCH. A writable
  // project_id would let a caller move a child onto a record they may write and
  // edit it there, which is the access check defeated by its own payload.
  for (const [name, spec] of SPECS) {
    assert.ok(!('project_id' in spec.fields), `${name}: project_id must not be writable`)
    assert.ok(!('opportunity_id' in spec.fields), `${name}: opportunity_id must not be writable`)
    assert.ok(!('id' in spec.fields), `${name}: id must not be writable`)
    assert.ok(!('created_at' in spec.fields), `${name}: created_at must not be writable`)
  }
})

test('a stamped timestamp is never also a writable field', () => {
  // A completion time the client supplies is not evidence of completion.
  for (const [name, spec] of SPECS) {
    if (!spec.stamp) continue
    assert.ok(
      !(spec.stamp.into in spec.fields),
      `${name}: ${spec.stamp.into} is stamped server-side and must not be in fields`
    )
  }
})

test('every path is distinguishable by prefix, so the role gate can name one', () => {
  // ROLE_API_PREFIXES allowlists `/api/records/milestones` for project_manager.
  // If one child's path were a prefix of another's, that line would grant both.
  for (const a of CHILD_PATHS) {
    for (const b of CHILD_PATHS) {
      if (a === b) continue
      assert.ok(!b.startsWith(a + '/'), `${b} sits underneath ${a}`)
      assert.notEqual(a, b)
    }
  }
  assert.ok(CHILD_PATHS.includes('/api/records/milestones'))
})

test('an unknown child name resolves to nothing', () => {
  // The route 404s on null, which is what stops /api/records/<anything> being
  // pointed at a table that is not in the map.
  assert.equal(getChild('auth.users'), null)
  assert.equal(getChild('activity_log'), null)
  assert.equal(getChild('__proto__'), null)
  assert.equal(getChild('constructor'), null)
  assert.ok(getChild('milestones'))
})

test('a create refuses a severity outside the enum instead of handing it to Postgres', () => {
  // Live 2026-09-23: severity "high" reached the database, came back 22P02 with
  // a NULL row set, and surfaced as a 500 with raw Postgres text.
  const spec = CHILDREN['dd-items']
  const bad = normalizePayload(spec, { category: 'legal', item: 'x', severity: 'high' })
  assert.equal(bad.ok, false)
  assert.match(bad.ok === false ? bad.error : '', /severity must be one of/)

  const good = normalizePayload(spec, { category: 'legal', item: 'x', severity: 'blocker' })
  assert.equal(good.ok, true)
})

test('compliance status is checked at the edge too — it is the same kind of enum', () => {
  const spec = CHILDREN['compliance-items']
  const bad = normalizePayload(spec, { framework: 'cmmc', requirement: 'x', status: 'done' })
  assert.equal(bad.ok, false)
  assert.match(bad.ok === false ? bad.error : '', /status must be one of/)
})

test('a PATCH touches only the keys the caller sent', () => {
  // §12: a field the caller never mentioned must be OMITTED, not nulled.
  // financing/[id] wrote `body.x ?? null` for all twelve of its columns.
  const spec = CHILDREN.financing
  const parsed = normalizePayload(spec, { lender: 'JPMorgan' }, { partial: true })
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.deepEqual(Object.keys(parsed.value), ['lender'])
    assert.equal(parsed.value.lender, 'JPMorgan')
  }
})

test('a create still demands what the table demands', () => {
  const parsed = normalizePayload(CHILDREN.milestones, { label: 'Close' })
  assert.equal(parsed.ok, false)
  assert.match(parsed.ok === false ? parsed.error : '', /stage is required/)
})

test('money arrives as a reader types it', () => {
  const parsed = normalizePayload(CHILDREN.financing, { senior_debt: '1,250,000' }, { partial: true })
  assert.equal(parsed.ok, true)
  if (parsed.ok) assert.equal(parsed.value.senior_debt, 1250000)
})

test('a boolean stamp writes a timestamp on, and clears it off', () => {
  const spec = CHILDREN.milestones
  const on: Record<string, unknown> = {}
  applyStamp(spec, { completed: true }, on)
  assert.equal(typeof on.completed_at, 'string')

  const off: Record<string, unknown> = {}
  applyStamp(spec, { completed: false }, off)
  assert.equal(off.completed_at, null)

  // Absent from the body means "not part of this edit" — not "clear it".
  const untouched: Record<string, unknown> = {}
  applyStamp(spec, { label: 'renamed' }, untouched)
  assert.deepEqual(untouched, {})
})

test('a value stamp fires only on the value that means done', () => {
  const spec = CHILDREN['dd-items']
  const resolved: Record<string, unknown> = {}
  applyStamp(spec, { status: 'resolved' }, resolved)
  assert.equal(typeof resolved.resolved_at, 'string')

  const reopened: Record<string, unknown> = {}
  applyStamp(spec, { status: 'open' }, reopened)
  assert.equal(reopened.resolved_at, null)
})

test('a jsonb column takes a structure and refuses a scalar', () => {
  const ok = normalizePayload(CHILDREN.financing, { draw_schedule: [{ month: 1 }] }, { partial: true })
  assert.equal(ok.ok, true)

  const bad = normalizePayload(CHILDREN.financing, { draw_schedule: 'quarterly' }, { partial: true })
  assert.equal(bad.ok, false)
})
