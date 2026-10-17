import { test } from 'node:test'
import assert from 'node:assert/strict'

import { COUNTED_ATTENTION_KINDS, hiddenProjectFilter } from './attention'

/**
 * These guard the ONE thing in this module that can fail silently.
 *
 * `countAttention()` head-counts rows, so it never receives any and cannot use
 * `dropHidden()` the way `computeAttention()` does — the exclusion has to
 * happen in SQL. Two §12 traps meet there: a malformed `.or()` returns an EMPTY
 * SET with no error, and a bare `not.in` is NULL for a NULL column and
 * therefore not true, which would discard every opportunity-attached row of
 * these shared-children tables.
 *
 * The SQL semantics were proved against the live database on 2026-10-17 inside
 * a transaction that rolled back: with two synthetic overdue tasks (one on a
 * hidden project, one with a null project_id) the baseline was 3, this filter
 * returned 2 — hidden one gone, null one kept — and the naive bare `not in`
 * returned 1, dropping the null row exactly as the rule warns. These tests keep
 * the STRING that produced that result from drifting.
 */

const A = '4f48f348-39b6-4d5a-9a98-92218501fd05'
const B = '27d9e75b-4d61-4386-9684-acc9d906a60c'

test('no confidential projects means no filter at all', () => {
  // Not an empty string: an empty `.or()` matches nothing, so the badge would
  // read 0 on a portfolio with no protected projects whatsoever.
  assert.equal(hiddenProjectFilter(new Set()), null)
})

test('a null project_id is KEPT, which is the trap', () => {
  const f = hiddenProjectFilter(new Set([A]))
  assert.ok(f, 'expected a filter')
  assert.ok(
    f.startsWith('project_id.is.null,'),
    'the null-keeping arm must come first and must be present — milestones, dd_items and tasks ' +
      'all hang off a project OR an opportunity, so a bare not.in silently drops every ' +
      'opportunity-attached row'
  )
  assert.equal(f, `project_id.is.null,project_id.not.in.(${A})`)
})

test('several hidden projects are comma-joined inside one parenthesised list', () => {
  const f = hiddenProjectFilter(new Set([A, B]))
  assert.equal(f, `project_id.is.null,project_id.not.in.(${A},${B})`)
})

test('a value that is not a uuid is dropped, never interpolated', () => {
  // The defence is the shape test, not escaping. An id carrying a parenthesis
  // or a comma would otherwise rewrite the logic tree.
  assert.equal(hiddenProjectFilter(new Set(['nonsense'])), null)
  assert.equal(hiddenProjectFilter(new Set([')', 'a,b'])), null)
  assert.equal(hiddenProjectFilter(new Set(['nonsense', A])), `project_id.is.null,project_id.not.in.(${A})`)
})

test('the filter never contains an unquoted bracket beyond its own list', () => {
  const f = hiddenProjectFilter(new Set([A, B]))!
  assert.equal((f.match(/\(/g) ?? []).length, 1)
  assert.equal((f.match(/\)/g) ?? []).length, 1)
})

test('the counted kinds are exactly the four the badge sums', () => {
  // `countAttention()` adds four numbers. If a fifth kind is ever counted there
  // without being named here, this fails — which is the point: the sidebar
  // badge and the KPI tile read this list to mean the same thing by the same
  // name, and three different "Needs Attention" numbers were once on screen.
  assert.deepEqual([...COUNTED_ATTENTION_KINDS], [
    'overdue_milestone',
    'critical_dd',
    'overdue_task',
    'expiring_certification',
  ])
})

test('the Decide queue is not one of them', () => {
  // Folding the review/lead backlog into attention is the specific mistake
  // HealthPanel's docblock records: the tile read 197 while the sidebar read 1.
  assert.ok(!COUNTED_ATTENTION_KINDS.some((k) => k.includes('lead') || k.includes('review')))
})
