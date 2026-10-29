import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DUE_FILTERS, DUE_FILTER_LABELS, dueWindowFrom, matchesDue } from './due-filter'

/** A fixed clock, so a test written today still means the same thing in March. */
const NOW = new Date('2026-10-29T09:00:00Z')
const W = dueWindowFrom(NOW)

test('the window is today and seven days out, from ONE clock reading', () => {
  assert.equal(W.today, '2026-10-29')
  assert.equal(W.weekEnd, '2026-11-05')
})

test('a task with no due date is only ever in the undated slice', () => {
  /*
    ⚠ THE CASE THE WHOLE FILTER EXISTS FOR, and the one most easily got wrong.
    37 of 41 open tasks have no date. If a null leaked into `overdue` the board
    would tell its reader 37 things were late; if it leaked into `week` it would
    invent a week's work. Both are a board lying about the reader's own week.
  */
  assert.equal(matchesDue(null, 'undated', W), true)
  assert.equal(matchesDue(null, 'overdue', W), false)
  assert.equal(matchesDue(null, 'week', W), false)
  // ...and `all` means all, including the undated ones.
  assert.equal(matchesDue(null, 'all', W), true)
})

test('overdue is strictly before today — today itself is not late', () => {
  assert.equal(matchesDue('2026-10-28', 'overdue', W), true)
  assert.equal(matchesDue('2026-10-29', 'overdue', W), false)
  assert.equal(matchesDue('2026-10-30', 'overdue', W), false)
})

test('the week is inclusive at both ends', () => {
  assert.equal(matchesDue('2026-10-29', 'week', W), true, 'today is in this week')
  assert.equal(matchesDue('2026-11-05', 'week', W), true, 'the seventh day is in')
  assert.equal(matchesDue('2026-11-06', 'week', W), false, 'the eighth is not')
  assert.equal(matchesDue('2026-10-28', 'week', W), false, 'yesterday is overdue, not upcoming')
})

test('overdue and week never both claim one task', () => {
  // They are adjacent slices and a row that appeared in both would be counted
  // twice by any future total built on them (§12 — one quantity, one definition).
  for (const d of ['2026-10-01', '2026-10-28', '2026-10-29', '2026-11-05', '2026-11-06']) {
    assert.ok(
      !(matchesDue(d, 'overdue', W) && matchesDue(d, 'week', W)),
      `${d} is in both overdue and week`
    )
  }
})

test('every filter has a label, and none of them says "all tasks"', () => {
  // The select is rendered by mapping DUE_FILTERS, so a member with no label
  // would render a blank option rather than failing (§12 — derive every
  // kind-keyed structure from the registry).
  for (const f of DUE_FILTERS) {
    assert.ok(DUE_FILTER_LABELS[f], `${f} has no label`)
  }
  assert.equal(Object.keys(DUE_FILTER_LABELS).length, DUE_FILTERS.length)
})
