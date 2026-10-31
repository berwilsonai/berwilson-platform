/**
 * The ramp schedule's total must be the sum Richard wrote down, must never be
 * an unlabelled number, and must agree with itself on every surface.
 *
 * ⚠ THE FIRST TEST IS RICHARD'S OWN WORKED EXAMPLE, and it is here because §12
 * warns that a worked example whose figures coincide cannot distinguish two
 * readings of the rule it illustrates. His — 100 MW by Jun 2027, 300 MW by Aug
 * 2029, total 400 — is the rare one that DOES pull them apart: an increment
 * reading gives 400 and a cumulative reading gives 300. Had he written "100
 * then 400, total 400" the example would have been satisfied by both readings
 * and the test would prove nothing. That is the whole reason the increment rule
 * can be asserted at all, so the test says so.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MAX_POWER_PHASES,
  cumulativeRamp,
  formatMegawatts,
  nextPhase,
  phaseLookup,
  portfolioPower,
  powerCoverageNote,
  powerTotal,
  sortPhases,
  subtreePower,
  type PowerPhase,
} from './power'

const RICHARD = [
  { phase_no: 1, megawatts: 100, target_date: '2027-06-01' },
  { phase_no: 2, megawatts: 300, target_date: '2029-08-01' },
] satisfies PowerPhase[]

// ── The worked example ───────────────────────────────────────────────────────

test("Richard's example totals 400 MW, which is the increment reading", () => {
  const total = powerTotal(RICHARD)
  assert.equal(total.megawatts, 400)
  // The cumulative reading would give 300. This assertion is the one that
  // distinguishes them, and it is why the example was usable as a test at all.
  assert.notEqual(total.megawatts, 300)
  assert.equal(total.phases, 2)
  assert.equal(total.dated, 2)
  assert.equal(total.firstDate, '2027-06-01')
  assert.equal(total.lastDate, '2029-08-01')
})

test('the running total is shown cumulatively while the increments are stored', () => {
  const steps = cumulativeRamp(RICHARD)
  assert.deepEqual(
    steps.map((s) => [s.megawatts, s.cumulative]),
    [
      [100, 100],
      [300, 400],
    ]
  )
})

// ── Absence is not zero ──────────────────────────────────────────────────────

test('no schedule is NULL, never 0 — a 0 MW deal is a fact nobody typed', () => {
  const total = powerTotal([])
  assert.equal(total.megawatts, null)
  assert.equal(total.phases, 0)
  assert.equal(total.definition, 'No ramp schedule')
})

test('a blank numeric string is absent, not 0 (Number("") === 0)', () => {
  assert.equal(powerTotal([{ phase_no: 1, megawatts: '' }]).megawatts, null)
  assert.equal(powerTotal([{ phase_no: 1, megawatts: '   ' }]).megawatts, null)
  assert.equal(powerTotal([{ phase_no: 1, megawatts: null }]).megawatts, null)
})

test('PostgREST hands numeric back as a STRING, and it must be summed not concatenated', () => {
  const total = powerTotal([
    { phase_no: 1, megawatts: '100' },
    { phase_no: 2, megawatts: '300.50' },
  ])
  assert.equal(total.megawatts, 400.5)
})

test('every figure carries a definition — an unlabelled number is the old bug', () => {
  for (const phases of [[], RICHARD, [{ phase_no: 1, megawatts: 12.5 }]]) {
    const total = powerTotal(phases)
    assert.ok(total.definition.length > 0, 'definition missing')
    assert.ok(total.hint.length > 0, 'hint missing')
  }
})

// ── Dates ────────────────────────────────────────────────────────────────────

test('a phase with no date still counts toward the total, and is reported as undated', () => {
  const total = powerTotal([
    { phase_no: 1, megawatts: 100, target_date: '2027-06-01' },
    { phase_no: 2, megawatts: 300, target_date: null },
  ])
  assert.equal(total.megawatts, 400)
  assert.equal(total.phases, 2)
  assert.equal(total.dated, 1)
  assert.match(total.hint, /1 of 2 phases dated/)
})

test('nextPhase picks the soonest phase still ahead, and null once all are past', () => {
  const now = new Date('2028-01-15T12:00:00Z')
  assert.equal(nextPhase(RICHARD, now)?.phase_no, 2)
  assert.equal(nextPhase(RICHARD, new Date('2030-01-01T12:00:00Z')), null)
  assert.equal(nextPhase([{ phase_no: 1, megawatts: 10 }], now), null)
})

test('a phase due TODAY is still ahead — compared as ISO days, never as Date objects', () => {
  // A DATE column parsed to a Date lands at UTC midnight, so anyone west of UTC
  // sees the previous day. §12 records this against nine copies of the date
  // formatter; this is the assertion that stops it coming back here.
  const today = new Date(2027, 5, 1, 23, 30) // 1 Jun 2027, local, late evening
  assert.equal(nextPhase(RICHARD, today)?.phase_no, 1)
})

// ── Formatting ───────────────────────────────────────────────────────────────

test('megawatts print as MW with separators, never abbreviated to GW', () => {
  assert.equal(formatMegawatts(400), '400 MW')
  assert.equal(formatMegawatts(1200), '1,200 MW')
  // The comparability rule: 900 and 1200 must be read against each other
  // without unit arithmetic.
  assert.ok(!formatMegawatts(1200).includes('GW'))
  assert.equal(formatMegawatts(12.5), '12.5 MW')
  assert.equal(formatMegawatts(400.0), '400 MW', 'no trailing .0')
  assert.equal(formatMegawatts(null), '—')
  assert.equal(formatMegawatts(400, { unit: false }), '400')
})

test('sortPhases orders by phase number, which is the schema key', () => {
  const out = sortPhases([
    { phase_no: 3, megawatts: 1 },
    { phase_no: 1, megawatts: 1 },
    { phase_no: 2, megawatts: 1 },
  ])
  assert.deepEqual(out.map((p) => p.phase_no), [1, 2, 3])
})

test('six is the width of the form and the schema agrees', () => {
  assert.equal(MAX_POWER_PHASES, 6)
})

// ── Shared children: an opportunity's phases must not be dropped ─────────────

test('phaseLookup keys on EITHER parent — project_id is null on an opportunity row', () => {
  const lookup = phaseLookup([
    { phase_no: 1, megawatts: 100, project_id: 'p1', opportunity_id: null },
    { phase_no: 1, megawatts: 250, project_id: null, opportunity_id: 'o1' },
  ])
  assert.equal(powerTotal(lookup('p1')).megawatts, 100)
  // The version that keyed on project_id alone silently dropped this one.
  assert.equal(powerTotal(lookup('o1')).megawatts, 250)
  assert.equal(powerTotal(lookup('unknown')).megawatts, null)
})

// ── Hierarchy ────────────────────────────────────────────────────────────────

const PROGRAM = { id: 'prog', parent_project_id: null }
const SITE_A = { id: 'a', parent_project_id: 'prog' }
const SITE_B = { id: 'b', parent_project_id: 'prog' }
const SET = [PROGRAM, SITE_A, SITE_B]

test("a program's capacity is its leaves', never its own as well", () => {
  const lookup = phaseLookup([
    { phase_no: 1, megawatts: 900, project_id: 'prog' },
    { phase_no: 1, megawatts: 300, project_id: 'a' },
    { phase_no: 1, megawatts: 300, project_id: 'b' },
  ])
  const rolled = subtreePower(PROGRAM, SET, lookup)
  assert.equal(rolled.megawatts, 600, 'the leaves, not 600 + 900')
  assert.equal(rolled.rolled, true)
  assert.equal(rolled.leaves, 2)
  // The overruled figure is REPORTED, not silently dropped.
  assert.equal(rolled.ownTotal?.megawatts, 900)

  // And the portfolio counts the same 600 once, not 1,500.
  assert.equal(portfolioPower(SET, lookup).megawatts, 600)
})

test('a parent with no children is a leaf and answers for itself', () => {
  const lookup = phaseLookup([{ phase_no: 1, megawatts: 400, project_id: 'solo' }])
  const solo = { id: 'solo', parent_project_id: null }
  const value = subtreePower(solo, [solo], lookup)
  assert.equal(value.megawatts, 400)
  assert.equal(value.rolled, false)
})

test("empty leaves fall back to the program's own schedule — and the portfolio agrees", () => {
  // The one deliberate divergence from the money rule. Nothing is double
  // counted: the leaves contribute zero.
  const lookup = phaseLookup([{ phase_no: 1, megawatts: 400, project_id: 'prog' }])
  const rolled = subtreePower(PROGRAM, SET, lookup)
  assert.equal(rolled.megawatts, 400)
  assert.equal(rolled.rolled, false, 'it is a fallback, and must not claim to be a roll-up')
  assert.match(rolled.hint, /sub-projects carry no schedule/)

  // ⚠ THE POINT OF THE TEST. A leaf-filtering portfolio total would say 0 here
  // while the program's own page said 400 — one quantity, two definitions.
  assert.equal(portfolioPower(SET, lookup).megawatts, 400)
})

test('a child whose parent is absent from the set still counts for itself', () => {
  // `dropHidden` (confidential projects) and every URL filter produce exactly
  // this set. Judging roots by the column alone would vanish it from its own
  // total.
  const lookup = phaseLookup([{ phase_no: 1, megawatts: 300, project_id: 'a' }])
  assert.equal(portfolioPower([SITE_A], lookup).megawatts, 300)
})

test('coverage names how much of the set the total covers', () => {
  const lookup = phaseLookup([{ phase_no: 1, megawatts: 300, project_id: 'a' }])
  const total = portfolioPower([SITE_A, { id: 'c', parent_project_id: null }], lookup)
  assert.equal(total.megawatts, 300)
  assert.equal(total.withSchedule, 1)
  assert.equal(total.without, 1)
  assert.equal(powerCoverageNote(total), '1 of 2 scheduled')
  assert.equal(powerCoverageNote({ megawatts: 0, withSchedule: 0, without: 3, rolledUp: 0 }), 'none of 3 scheduled')
  assert.equal(powerCoverageNote({ megawatts: 9, withSchedule: 2, without: 0, rolledUp: 0 }), null)
})

test('a cycle in parent_project_id does not hang the page', () => {
  const x = { id: 'x', parent_project_id: 'y' }
  const y = { id: 'y', parent_project_id: 'x' }
  const lookup = phaseLookup([{ phase_no: 1, megawatts: 50, project_id: 'x' }])
  assert.doesNotThrow(() => subtreePower(x, [x, y], lookup))
  assert.doesNotThrow(() => portfolioPower([x, y], lookup))
})
