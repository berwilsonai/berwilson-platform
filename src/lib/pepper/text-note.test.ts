/**
 * The morning text's shape. Pure functions, no database, no clock of their own.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { composeMorningText, composeWeekAheadText } from './text-note'
import type { PepperNote } from './assemble'

const NOW = new Date('2026-10-12T13:00:00Z')

/** A note with nothing in it; each test fills in only what it is about. */
function emptyNote(over: Partial<PepperNote> = {}): PepperNote {
  const base = {
    member: { id: 'm1', name: 'Richard', email: 'moose@berwilson.com' },
    sinceIso: '2026-10-09T00:00:00Z',
    sinceLabel: 'since Friday',
    owed: [],
    awaited: [],
    sharedOwed: [],
    sharedAwaited: [],
    omitted: { owed: 0, awaited: 0, sharedOwed: 0, sharedAwaited: 0 },
    overdueTasks: [],
    dueSoonTasks: [],
    liveTasks: [],
    meetings: [],
    weekMeetings: [],
    decide: { total: 0, leads: 0, intake: 0, meetings: 0, review: 0, documents: 0, economics: 0, top: [] },
    cracks: [],
    overnight: {},
    notes: [],
  }
  return { ...base, ...over } as unknown as PepperNote
}

/**
 * A commitment as the note carries it.
 *
 * Cast because `CommitmentRow` is the full 21-column generated row and these
 * tests are about three of its fields. The alternative — spelling out every
 * column in every fixture — makes the test about the schema rather than about
 * the message.
 */
function owed(id: string, what: string, dueDate: string | null = null) {
  return { row: { id, what, due_date: dueDate }, via: 'name' } as unknown as PepperNote['owed'][number]
}

function task(over: Record<string, unknown>) {
  return {
    id: 't1', title: 'A task', why: null, due_date: null, assignee_id: 'm1',
    project_name: null, opportunity_name: null, project_id: null,
    opportunity_id: null, commitment_id: null, ...over,
  }
}

test('a quiet morning returns a REASON, not a cheerful nothing', () => {
  // A daily message that is usually "nothing today" trains the reader to stop
  // opening it, so the caller is told why rather than handed filler.
  const r = composeMorningText({ note: emptyNote(), appUrl: null, now: NOW })
  assert.equal(r.body, '')
  assert.match(r.emptyReason ?? '', /nothing due/)
})

test('overdue leads, and due-today is not double-counted as overdue', () => {
  const r = composeMorningText({
    note: emptyNote({
      overdueTasks: [task({ id: 'a', title: 'Steelton PSA signature', due_date: '2026-10-05' })],
      dueSoonTasks: [task({ id: 'b', title: 'Fairbanks mining contract', due_date: '2026-10-12' })],
    }),
    appUrl: null,
    now: NOW,
  })
  assert.match(r.body, /^Morning, Richard\./)
  assert.match(r.body, /1 overdue: Steelton PSA signature/)
  assert.match(r.body, /Due today: Fairbanks mining contract/)
  // The overdue one must not also appear under "due today".
  assert.equal(r.body.match(/Steelton PSA signature/g)?.length, 1)
})

test('only TODAY\'S meetings, with the counterparty named', () => {
  const r = composeMorningText({
    note: emptyNote({
      meetings: [
        { subject: 'Tensor IQ call', start: '2026-10-12T15:30:00Z', isAllDay: false, location: null,
          counterparties: [{ name: 'Merlin Corbin', email: 'm@z.com', lastContactDays: 2, openItems: [] }] },
        { subject: 'Next week thing', start: '2026-10-19T15:30:00Z', isAllDay: false, location: null,
          counterparties: [] },
      ],
    }),
    appUrl: null,
    now: NOW,
  })
  assert.match(r.body, /Tensor IQ call \(Merlin Corbin\)/)
  assert.doesNotMatch(r.body, /Next week thing/)
})

test('an all-day meeting says so instead of printing 00:00', () => {
  const r = composeMorningText({
    note: emptyNote({
      meetings: [{ subject: 'Site visit', start: '2026-10-12T00:00:00Z', isAllDay: true, location: null, counterparties: [] }],
    }),
    appUrl: null,
    now: NOW,
  })
  assert.match(r.body, /All day Site visit/)
})

test('the two ledger quantities are NAMED APART and never summed', () => {
  // §12: one quantity, one definition — three "needs attention" numbers on one
  // screen were 1, 99+ and 197 because each surface summed its own list.
  const r = composeMorningText({
    note: emptyNote({
      owed: [1, 2, 3].map((n) => owed(`c${n}`, 'x')),
      awaited: [1, 2].map((n) => owed(`d${n}`, 'y')),
      decide: { total: 12, leads: 0, intake: 12, meetings: 0, review: 0, documents: 0, economics: 0, top: [] },
    }),
    appUrl: null,
    now: NOW,
  })
  assert.match(r.body, /You owe 3, waiting on 2/)
  // ⚠ The decide total is deliberately absent: the live dry run rendered it as
  // "272 to decide", which is the only-ever-grows number this channel exists
  // to escape. It stays in the 06:50 email, which has a link on every row.
  assert.doesNotMatch(r.body, /to decide/)
  assert.doesNotMatch(r.body, /17|15/)
})

test('the link is appended and never duplicated by a trailing slash', () => {
  const r = composeMorningText({
    note: emptyNote({ overdueTasks: [task({ due_date: '2026-10-01' })] }),
    appUrl: 'https://host.ts.net/',
    now: NOW,
  })
  assert.match(r.body, /\nhttps:\/\/host\.ts\.net\/attention$/)
})

test('forty overdue tasks still produce a four-line text', () => {
  // ⚠ THE REAL GUARANTEE IS THE PER-SECTION CAPS, NOT THE CLAMP. The first
  // version of this test asserted the clamp fired and failed, because
  // `nameList` had already reduced forty tasks to two names and "+38 more".
  // That is the property worth locking down: the message cannot grow with the
  // backlog, which is the whole reason this channel is not the email.
  const many = Array.from({ length: 40 }, (_, i) =>
    task({ id: `t${i}`, title: `A fairly long overdue task title number ${i}`, due_date: '2026-09-01' })
  )
  const r = composeMorningText({
    note: emptyNote({ overdueTasks: many }),
    appUrl: 'https://host.ts.net',
    now: NOW,
  })
  assert.ok(r.body.length <= 520, `was ${r.body.length}`)
  assert.ok(r.body.split('\n').filter(Boolean).length <= 4, r.body)
  assert.match(r.body, /\+38 more/)
  assert.match(r.body, /https:\/\/host\.ts\.net\/attention$/)
})

test('an unbounded calendar subject is shortened, not printed whole', () => {
  const r = composeMorningText({
    note: emptyNote({
      meetings: [{
        subject: 'FW: RE: Ber Wilson / Cleveland-Cliffs — Steelton, Riverdale & Weirton PSA closing mechanics and escrow',
        start: '2026-10-12T15:30:00Z', isAllDay: false, location: null, counterparties: [],
      }],
    }),
    appUrl: null,
    now: NOW,
  })
  assert.ok(r.body.length < 200, `was ${r.body.length}`)
  assert.match(r.body, /…/)
})

test('the week-ahead NEVER reports a past date as due this week', () => {
  // ⚠ THE LIVE DRY RUN DID EXACTLY THIS: "Due this week: 9 Sept …; 11 Feb …".
  // The filter had an upper bound and no lower one, and most of the dated
  // commitments in this ledger are months gone, so it was certain to fire.
  const r = composeWeekAheadText({
    note: emptyNote({
      owed: [
        owed('old', 'Something from September', '2026-09-09'),
        owed('soon', 'Steelton PSA closing', '2026-10-15'),
      ],
    }),
    appUrl: null,
    now: NOW,
  })
  assert.doesNotMatch(r.body, /Sept/)
  assert.match(r.body, /1 already overdue\./)
  assert.match(r.body, /Due this week: 15 Oct Steelton PSA closing/)
})

test('an all-day calendar marker counts as a deadline, not a meeting', () => {
  const r = composeWeekAheadText({
    note: emptyNote({
      weekMeetings: [
        { subject: 'BID DUE — Adams County', start: '2026-10-14T00:00:00Z', isAllDay: true, location: null, counterparties: [] },
        { subject: 'Tensor IQ', start: '2026-10-13T15:30:00Z', isAllDay: false, location: null, counterparties: [] },
      ],
    }),
    appUrl: null,
    now: NOW,
  })
  assert.match(r.body, /1 meeting: Tue Tensor IQ/)
  assert.match(r.body, /Due this week: 14 Oct BID DUE — Adams County/)
})

test('the week-ahead names weekdays and dates, and stops at the week', () => {
  const r = composeWeekAheadText({
    note: emptyNote({
      weekMeetings: [
        { subject: 'Tensor IQ', start: '2026-10-13T15:30:00Z', isAllDay: false, location: null, counterparties: [] },
        { subject: 'Far future', start: '2026-11-30T15:30:00Z', isAllDay: false, location: null, counterparties: [] },
      ],
      owed: [owed('c1', 'Steelton PSA closing', '2026-10-15')],
    }),
    appUrl: null,
    now: NOW,
  })
  assert.match(r.body, /^Week ahead, Richard\./)
  assert.match(r.body, /1 meeting: Tue Tensor IQ/)
  assert.doesNotMatch(r.body, /Far future/)
  assert.match(r.body, /Due this week: 15 Oct Steelton PSA closing/)
})

/**
 * ⚠ THE TEST THAT WAS MISSING, AND ITS ABSENCE IS WHY THE BUG SURVIVED.
 *
 * `composeWeekAheadText` filtered a seven-day window over `note.meetings`,
 * which `assembleMeetings` only ever populated with TODAY — so the Monday text
 * was structurally incapable of naming a meeting later in the week. Every
 * existing test passed because the fixture injected a Tuesday meeting straight
 * into `meetings`, bypassing the one-day fetch that was the actual defect.
 *
 * This asserts the two fields are not interchangeable: a meeting that exists
 * ONLY in today's feed must not be counted as the week's, and the week's feed
 * is what gets read. It fails against the old code in both directions.
 */
test('the week-ahead reads weekMeetings, never today-only meetings', () => {
  const r = composeWeekAheadText({
    note: emptyNote({
      // Today's block, with its counterparty context. Not the week's.
      meetings: [
        { subject: 'Monday standup', start: '2026-10-12T15:00:00Z', isAllDay: false, location: null, counterparties: [] },
      ],
      weekMeetings: [
        { subject: 'Thursday closing call', start: '2026-10-15T16:00:00Z', isAllDay: false, location: null, counterparties: [] },
        { subject: 'BID DUE — Weirton', start: '2026-10-16T00:00:00Z', isAllDay: true, location: null, counterparties: [] },
      ],
    }),
    appUrl: null,
    now: NOW,
  })
  // The week's meeting is named, with its own weekday — not Monday's.
  assert.match(r.body, /1 meeting: Thu Thursday closing call/)
  assert.doesNotMatch(r.body, /Monday standup/)
  // And an all-day marker later in the week reaches the deadline list, which
  // today's feed could never have shown.
  assert.match(r.body, /Due this week: 16 Oct BID DUE — Weirton/)
})

test('a counterparty known only by address is omitted, not printed', () => {
  const r = composeMorningText({
    note: emptyNote({
      meetings: [{ subject: 'Ber Wilson chat', start: '2026-10-12T15:00:00Z', isAllDay: false, location: null,
        counterparties: [{ name: 'englertmining@gmail.com', email: 'englertmining@gmail.com', lastContactDays: 1, openItems: [] }] }],
    }),
    appUrl: null,
    now: NOW,
  })
  assert.match(r.body, /Ber Wilson chat/)
  assert.doesNotMatch(r.body, /@/)
})

test('a name with no surname still gets a greeting', () => {
  const r = composeMorningText({
    note: emptyNote({ overdueTasks: [task({ due_date: '2026-10-01' })] }),
    appUrl: null,
    now: NOW,
  })
  assert.match(r.body, /^Morning, Richard\./)
})

/**
 * ⚠ WHAT SHE NAMED, NOT WHAT SHE HELD.
 *
 * `namedTaskIds` feeds `recordMentions`, so it is the difference between "this
 * is the fourth morning" being true and being a guess. `nameList` prints two
 * titles and counts the rest, so recording all five would have Pepper claiming
 * she named three tasks she only summarised — and the escalation clause would
 * then fire on rows the reader has never seen written out.
 */
test('namedTaskIds carries only the titles that were actually printed', () => {
  const r = composeMorningText({
    note: emptyNote({
      overdueTasks: [
        task({ id: 'a', title: 'Steelton PSA signature', due_date: '2026-10-05' }),
        task({ id: 'b', title: 'Weirton data room', due_date: '2026-10-06' }),
        task({ id: 'c', title: 'Riverdale survey', due_date: '2026-10-07' }),
      ],
    }),
    appUrl: null,
    now: NOW,
  })
  // Three overdue, two titles printed, one counted.
  assert.match(r.body, /3 overdue: Steelton PSA signature, Weirton data room/)
  assert.deepEqual(r.namedTaskIds, ['a', 'b'])
})

test('an empty text names nothing, so a skipped send records nothing', () => {
  const r = composeMorningText({ note: emptyNote(), appUrl: null, now: NOW })
  assert.equal(r.body, '')
  assert.deepEqual(r.namedTaskIds, [])
})

test('the week-ahead records the dated tasks it printed, never the commitments', () => {
  const r = composeWeekAheadText({
    note: emptyNote({
      dueSoonTasks: [task({ id: 'wk1', title: 'File the rezone exhibit', due_date: '2026-10-14' })],
      // A commitment has no task row to escalate, so it contributes no id.
      owed: [owed('c1', 'Steelton PSA closing', '2026-10-15')],
    }),
    appUrl: null,
    now: NOW,
  })
  assert.match(r.body, /Due this week: 14 Oct File the rezone exhibit/)
  assert.deepEqual(r.namedTaskIds, ['wk1'])
})
