import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pagerPosition } from './pager'

const rows = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'c', name: 'Charlie' },
  { id: 'd', name: 'Delta' },
]

test('position and neighbours in the middle of the register', () => {
  const p = pagerPosition(rows, 'b')
  assert.equal(p?.index, 2)
  assert.equal(p?.total, 4)
  assert.equal(p?.prev?.id, 'a')
  assert.equal(p?.next?.id, 'c')
})

test('the ends have one neighbour, not a wrap', () => {
  // Wrapping would make the chain a loop with no way to tell you reached the
  // end, which is worse than a disabled arrow.
  assert.equal(pagerPosition(rows, 'a')?.prev, null)
  assert.equal(pagerPosition(rows, 'a')?.next?.id, 'b')
  assert.equal(pagerPosition(rows, 'd')?.next, null)
  assert.equal(pagerPosition(rows, 'd')?.prev?.id, 'c')
})

test('a hidden record is removed from the chain AND from the count', () => {
  // §8: a protected project leaves every cross-portfolio list. The count is
  // part of the list — "3 of 4" over a register of 3 is a disclosure.
  const p = pagerPosition(rows, 'a', new Set(['c']))
  assert.equal(p?.total, 3, 'the total must be taken after the exclusion')
  assert.equal(p?.index, 1)
  // And the chain must skip it rather than offering it as the next step.
  const q = pagerPosition(rows, 'b', new Set(['c']))
  assert.equal(q?.next?.id, 'd')
})

test('standing ON a hidden record renders nothing at all', () => {
  // A position in a list the record has been removed from is not a meaningful
  // number, and a chain drawn around it would leak its neighbours' order.
  assert.equal(pagerPosition(rows, 'c', new Set(['c'])), null)
})

test('a record missing from its own register says nothing', () => {
  // Filtered out by a grant, or moved between two queries. "0 of 4" is worse.
  assert.equal(pagerPosition(rows, 'zzz'), null)
})

test('a register with nowhere to go renders nothing', () => {
  assert.equal(pagerPosition([rows[0]], 'a'), null)
  assert.equal(pagerPosition([], 'a'), null)
  // One visible sibling left after the filter is still a chain.
  assert.equal(pagerPosition(rows, 'a', new Set(['c', 'd']))?.total, 2)
  // ...and none is not.
  assert.equal(pagerPosition(rows, 'a', new Set(['b', 'c', 'd'])), null)
})

test('the ordering it is given is the ordering it reports', () => {
  // The caller orders by name; this must not re-sort, or the arrows and the
  // list a reader just came from would disagree.
  const reversed = [...rows].reverse()
  assert.equal(pagerPosition(reversed, 'c')?.prev?.id, 'd')
  assert.equal(pagerPosition(reversed, 'c')?.next?.id, 'b')
})
