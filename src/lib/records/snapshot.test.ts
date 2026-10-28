import { test } from 'node:test'
import assert from 'node:assert/strict'

import { daysBetween, deltaFrom } from './snapshot'

/*
  The arithmetic behind "↑ 4.2% vs last week".

  ⚠ EVERY CASE HERE IS ONE THAT PUTS `NaN` OR `Infinity` INTO THE MARKUP IF IT
  IS GOT WRONG, which §12 forbids explicitly — and none of them is reachable
  from the UI today, because `portfolio_snapshots` is empty until the first
  cron runs. A fixture that builds the field directly cannot catch a producer
  that never fills it, so the producer's own edge cases are tested here rather
  than waiting a week to meet them in production.
*/

test('a normal rise and fall read as a signed fraction', () => {
  // Compared with a tolerance, not `deepEqual`: 4.2/100 is 0.04200000000000003
  // in binary floating point, and a test that pins the exact double is testing
  // IEEE 754 rather than the rule.
  const up = deltaFrom(104.2, 100, 7)
  assert.ok(up && Math.abs(up.change - 0.042) < 1e-9, 'a rise is +4.2%')
  assert.equal(up?.sinceDays, 7)
  const down = deltaFrom(90, 100, 7)
  assert.ok(down && Math.abs(down.change + 0.1) < 1e-9, 'a fall is negative')
})

test('no prior figure means NO delta, never a zero', () => {
  // The first weeks after this ships are exactly this case.
  assert.equal(deltaFrom(100, null, 7), null)
  assert.equal(deltaFrom(100, undefined, 7), null)
  assert.equal(deltaFrom(null, 100, 7), null)
  assert.equal(deltaFrom(undefined, undefined, 7), null)
})

test('a prior of zero has no percentage — it would be Infinity', () => {
  assert.equal(deltaFrom(12, 0, 7), null)
  assert.equal(deltaFrom(0, 0, 7), null)
})

test('a current of zero against a real prior is a real −100%', () => {
  const d = deltaFrom(0, 50, 7)
  assert.ok(d && Math.abs(d.change + 1) < 1e-9, 'everything went away, and that is a fact')
})

test('a non-finite input never reaches the markup', () => {
  assert.equal(deltaFrom(Number.NaN, 100, 7), null)
  assert.equal(deltaFrom(100, Number.NaN, 7), null)
  assert.equal(deltaFrom(Number.POSITIVE_INFINITY, 100, 7), null)
  assert.equal(deltaFrom(100, Number.NEGATIVE_INFINITY, 7), null)
})

test('a negative prior still yields a sign a reader can trust', () => {
  // Not reachable from a pipeline total today, but `deltaFrom` is generic and
  // dividing by a raw negative would invert the arrow.
  const d = deltaFrom(-50, -100, 7)
  assert.ok(d && d.change > 0, 'less negative is an improvement, so the arrow points up')
})

test('daysBetween counts whole days and never goes negative', () => {
  assert.equal(daysBetween('2026-10-21', '2026-10-28'), 7)
  assert.equal(daysBetween('2026-10-28', '2026-10-28'), 0)
  // A prior dated after today is a clock problem, not a negative age.
  assert.equal(daysBetween('2026-11-04', '2026-10-28'), 0)
})

test('daysBetween survives a malformed date rather than emitting NaN', () => {
  assert.equal(daysBetween('not-a-date', '2026-10-28'), 0)
  assert.equal(daysBetween('2026-10-28', ''), 0)
})
