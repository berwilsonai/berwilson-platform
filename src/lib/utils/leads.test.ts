/**
 * The lead queue's "still needs working" predicate, and the bid-deadline window.
 *
 * ⚠ THESE EXIST BECAUSE THE QUANTITY HAS THREE READERS AND THEY MUST AGREE.
 * Leads came off /decide on 2026-10-22 and gained a sidebar badge; the badge
 * (`countLeadsNeedingWork`), the stat band on /leads and that page's default
 * view all select with the two functions below. The failure mode this guards
 * is the one §12 names — one screen carrying three numbers for one quantity —
 * and it is not hypothetical here: the stat band read `status !== 'spam'` and
 * called 600 leads "Open" while 9 were undecided.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  leadNeedsWork,
  leadClosingSoon,
  LEAD_NEEDS_WORK_STATUSES,
  LEAD_NEEDS_WORK_FIT_FILTER,
} from './leads'

/** Noon UTC so a date-only `bid_due_date` cannot straddle a day boundary. */
const NOW = Date.parse('2026-10-22T12:00:00Z')

function lead(over: Partial<{ status: string | null; fit_recommendation: string | null }> = {}) {
  return { status: 'new', fit_recommendation: 'pursue', ...over }
}

test('an undecided lead needs working', () => {
  assert.equal(leadNeedsWork(lead({ status: 'new' })), true)
  assert.equal(leadNeedsWork(lead({ status: 'reviewing' })), true)
})

test('a decided lead does not — ignored, expired, promoted, forwarded, spam', () => {
  // ⚠ THE BUG THIS NAILS DOWN. On 2026-10-22 the live table held 214 `ignored`
  // and 230 `expired` leads against 9 undecided ones; a predicate of
  // `status !== 'spam'` counted all 444 of them as work.
  for (const status of ['ignored', 'expired', 'promoted', 'forwarded', 'spam']) {
    assert.equal(leadNeedsWork(lead({ status })), false, `${status} should not need working`)
  }
})

test('a `pass` verdict is not work, whatever its status', () => {
  assert.equal(leadNeedsWork(lead({ status: 'new', fit_recommendation: 'pass' })), false)
})

test('⚠ AN UNSCORED LEAD IS WORK — a NULL verdict must not be filtered out', () => {
  // This is the half that `.neq('pass')` gets wrong in SQL, because PostgREST
  // treats NULL as not matching (§12). An untriaged bid invitation is the
  // single row that most needs a human, so both halves must admit it.
  assert.equal(leadNeedsWork(lead({ fit_recommendation: null })), true)
  // And the SQL half must be the OR form, never a bare neq, or the row test
  // above and the query disagree about the same lead.
  assert.ok(
    LEAD_NEEDS_WORK_FIT_FILTER.includes('fit_recommendation.is.null'),
    'the SQL filter must admit a NULL verdict'
  )
})

test('a null status is not work rather than a crash', () => {
  assert.equal(leadNeedsWork(lead({ status: null })), false)
})

test('the status list and the row test cannot drift apart', () => {
  // Every member of the list must pass the test, and the test must admit
  // nothing outside it. A list read by SQL and a test read by the browser is
  // exactly the transcribed-predicate shape §12 warns about.
  for (const status of LEAD_NEEDS_WORK_STATUSES) {
    assert.equal(leadNeedsWork(lead({ status })), true, `${status} is in the list`)
  }
  assert.equal(LEAD_NEEDS_WORK_STATUSES.length, 2)
})

test('closing soon: today counts, and so does the seventh day', () => {
  assert.equal(leadClosingSoon({ bid_due_date: '2026-10-22' }, NOW), true, 'due today')
  assert.equal(leadClosingSoon({ bid_due_date: '2026-10-29' }, NOW), true, 'day seven')
})

test('closing soon: the eighth day does not, and neither does yesterday', () => {
  assert.equal(leadClosingSoon({ bid_due_date: '2026-10-30' }, NOW), false)
  // ⚠ A CLOSED BID IS NOT URGENT, IT IS OVER. Counting it would put a red
  // badge on the sidebar for a deadline nobody can act on — and §12 is
  // explicit that when every badge is red the colour has stopped signifying.
  assert.equal(leadClosingSoon({ bid_due_date: '2026-10-21' }, NOW), false)
})

test('closing soon: no date, and a date that is not one', () => {
  assert.equal(leadClosingSoon({ bid_due_date: null }, NOW), false)
  assert.equal(leadClosingSoon({ bid_due_date: 'as soon as possible' }, NOW), false)
})

test('the window is a parameter, so the badge and a report can differ honestly', () => {
  assert.equal(leadClosingSoon({ bid_due_date: '2026-11-05' }, NOW), false)
  assert.equal(leadClosingSoon({ bid_due_date: '2026-11-05' }, NOW, 30), true)
})

test('⚠ closingSoon is a SUBSET of needsWork and can never exceed it', () => {
  // The two numbers sit side by side on the badge and the stat band. If an
  // urgent count could exceed its own total, the pair is unreadable — so the
  // relationship is asserted rather than assumed, over a set that mixes both.
  const rows = [
    { status: 'new', fit_recommendation: 'pursue', bid_due_date: '2026-10-23' },
    { status: 'new', fit_recommendation: null, bid_due_date: '2026-10-24' },
    { status: 'new', fit_recommendation: 'pass', bid_due_date: '2026-10-23' },
    { status: 'ignored', fit_recommendation: 'pursue', bid_due_date: '2026-10-23' },
    { status: 'expired', fit_recommendation: 'pursue', bid_due_date: '2026-10-23' },
    { status: 'reviewing', fit_recommendation: 'consider', bid_due_date: null },
  ]
  const working = rows.filter(leadNeedsWork)
  const soon = working.filter((r) => leadClosingSoon(r, NOW))
  assert.equal(working.length, 3, 'pass, ignored and expired are all out')
  assert.equal(soon.length, 2)
  assert.ok(soon.length <= working.length)
})
