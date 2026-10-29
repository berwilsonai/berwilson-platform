import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { stripComments } from '@/lib/ui/source-scan'
import {
  DECIDE_SORTS,
  asDecideSort,
  decideComparator,
  type DecideSort,
  type SortableDecideItem,
} from './rank'

/**
 * The queue's sort orders.
 *
 * Two different kinds of assertion here, and the second is the one that earns
 * its keep: the comparators are pure and easy, while "does every producer fill
 * the sort key" is a question no fixture can answer. §12: a fixture that builds
 * the field directly cannot catch a producer that never fills it — three tests
 * covered a week-ahead text that could not name a meeting after Monday because
 * each injected the shape the real fetch never produced. So the producer test
 * reads the real page source.
 */

/** A row with only what the comparators read. */
function row(p: Partial<SortableDecideItem> & { id: string }): SortableDecideItem {
  return { daysLeft: null, verdict: null, score: null, ...p }
}

const order = (sort: DecideSort, rows: SortableDecideItem[]) =>
  [...rows].sort(decideComparator(sort)).map((r) => r.id)

test('an unknown sort falls back to the default rather than throwing', () => {
  assert.equal(asDecideSort('recent'), 'recent')
  assert.equal(asDecideSort(null), 'consequence')
  assert.equal(asDecideSort(undefined), 'consequence')
  assert.equal(asDecideSort('score'), 'consequence')
  // The one a reader could plausibly type by hand, and the one §12 forbids
  // offering: it must not resolve to anything.
  assert.equal(asDecideSort('fit_score'), 'consequence')
})

test('recent reads arrivedAt, newest first, and sinks the undated', () => {
  const rows = [
    row({ id: 'old', arrivedAt: '2026-10-01T00:00:00Z' }),
    row({ id: 'undated', arrivedAt: null }),
    row({ id: 'new', arrivedAt: '2026-10-28T00:00:00Z' }),
  ]
  assert.deepEqual(order('recent', rows), ['new', 'old', 'undated'])
})

test('recent does not let a deadline overrule the date asked for', () => {
  // The whole point of a sort control: `consequence` puts the overdue bid top,
  // and asking for `recent` must actually change the answer.
  const rows = [
    row({ id: 'overdue-bid', daysLeft: -3, arrivedAt: '2026-09-01T00:00:00Z' }),
    row({ id: 'landed-today', arrivedAt: '2026-10-29T00:00:00Z' }),
  ]
  assert.deepEqual(order('consequence', rows), ['overdue-bid', 'landed-today'])
  assert.deepEqual(order('recent', rows), ['landed-today', 'overdue-bid'])
})

test('confident ranks a scored row above an unscored one', () => {
  const rows = [
    row({ id: 'none' }),
    row({ id: 'sure', confidence: 0.97 }),
    row({ id: 'unsure', confidence: 0.4 }),
  ]
  assert.deepEqual(order('confident', rows), ['sure', 'unsure', 'none'])
})

test('quick puts clearable rows first, consequence still leading inside each group', () => {
  const rows = [
    row({ id: 'blocked', clearable: false }),
    row({ id: 'clearable-small', clearable: true }),
    row({ id: 'clearable-urgent', clearable: true, daysLeft: 2 }),
  ]
  assert.deepEqual(order('quick', rows), ['clearable-urgent', 'clearable-small', 'blocked'])
})

test('every order is TOTAL — identical rows never swap between renders', () => {
  /*
    ⚠ THE BUG THIS EXISTS FOR. `decideWeight` is 0 for every row with no
    deadline, verdict or value, which on the live queue is every document row —
    the largest kind present. A comparator ending on the weight returns 0 for
    two such rows, and `sort` then leaves them in whatever order the preceding
    map-and-filter happened to produce. Same shape as the flat MEETING_BOOST
    that made all five staged meetings tie.
  */
  const a = row({ id: 'aaa' })
  const b = row({ id: 'bbb' })
  const c = row({ id: 'ccc' })
  for (const { value } of DECIDE_SORTS) {
    const forwards = order(value, [a, b, c])
    const backwards = order(value, [c, b, a])
    assert.deepEqual(
      forwards,
      backwards,
      `${value} is not a total order — three weightless rows sorted differently from each input order`
    )
    // And no comparator may ever call two distinct rows equal.
    const cmp = decideComparator(value)
    assert.notEqual(cmp(a, b), 0, `${value} returned 0 for two distinct rows`)
  }
})

test('EVERY producer on /decide fills arrivedAt', () => {
  /*
    ⚠ READ FROM THE REAL PAGE, WITH COMMENTS STRIPPED. Both halves matter. A
    fixture cannot see a producer that forgets the field, and an unstripped
    grep would be satisfied by the docblock on `DecideItem.arrivedAt` that
    explains why the field is required — §12: a test that scans the source tree
    must strip comments, or it measures its own documentation.

    A missing `arrivedAt` is invisible at runtime: the row simply sorts to the
    bottom of "Most recent", where it is indistinguishable from the oldest thing
    in the queue and reads as already dealt with.
  */
  const src = stripComments(readFileSync('src/app/decide/page.tsx', 'utf8'))
  const pushes = src.split('items.push(').slice(1)

  assert.ok(pushes.length >= 6, `expected every kind to push a row, found ${pushes.length}`)

  const missing: string[] = []
  for (const chunk of pushes) {
    const kind = /kind:\s*'([a-z]+)'/.exec(chunk)?.[1]
    if (!kind) continue
    // The object literal ends at the first `})` that closes this push.
    const body = chunk.slice(0, chunk.indexOf('})'))
    if (!/\barrivedAt:/.test(body)) missing.push(kind)
  }

  assert.deepEqual(
    missing,
    [],
    `these /decide producers do not set arrivedAt, so they sort last under "Most recent": ${missing.join(', ')}`
  )
})

test('the sort control offers no order built on fit_score', () => {
  // §12: fit_score carries ±20 points of sampling noise, and `decideWeight`'s
  // own note records removing it as a TIEBREAKER. Offering it as the primary
  // key would be strictly worse than the bug that was fixed.
  for (const { value, label } of DECIDE_SORTS) {
    assert.ok(!/score/i.test(value), `sort '${value}' names a score`)
    assert.ok(!/score/i.test(label), `sort label '${label}' offers a score`)
  }
})
