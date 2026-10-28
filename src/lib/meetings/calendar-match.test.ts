import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  clockContains,
  dedupeCalendarEvents,
  hasInvitees,
  matchRecordingToEvent,
  searchWindow,
  significantTokens,
  titleScore,
  FALLBACK_LOOKBACK_DAYS,
  FALLBACK_LOOKAHEAD_DAYS,
  SMALL_MEETING_INVITEES,
} from './calendar-match'
import { unionAssertedAttendees } from './record'
import type { CalendarEvent } from '@/lib/integrations/google-workspace'
import type { MeetingAttendee } from '@/lib/utils/meetings'

function event(partial: Partial<CalendarEvent> & { subject: string; start: string; end: string }): CalendarEvent {
  return {
    id: partial.id ?? partial.subject,
    bodyPreview: '',
    isAllDay: false,
    location: null,
    organizer: null,
    attendees: [],
    webLink: '',
    joinUrl: null,
    ...partial,
  }
}

function attendee(partial: Partial<MeetingAttendee> & { name: string }): MeetingAttendee {
  return { role: null, org: null, email: null, party_id: null, team_member_id: null, ...partial }
}

// ── The title bar ───────────────────────────────────────────────────────────

test('the real failure: a Plaude export named after the invitation joins it', () => {
  // The exact pair measured on 2026-10-28 — file name against event subject.
  assert.equal(titleScore('10-23_Ber_Wilson_meeting_w_Brent_Bennett', 'Ber Wilson meeting w Brent Bennett'), 2)
})

test('an identical title scores higher than a containment', () => {
  assert.equal(titleScore('Ber Wilson / Zenthium', 'Ber Wilson / Zenthium'), 3)
})

test('a two-word subject may match exactly but never by containment', () => {
  // "KAVA Talks" is 33 of the 203 events on these two calendars in 2026, and
  // "Vultr Pregame", "Vultr Debrief" and "Partnership Discussion" are the same
  // shape. A filename happening to contain one is a coincidence.
  assert.equal(titleScore('KAVA Talks', 'KAVA Talks'), 3)
  assert.equal(titleScore('Recording of the KAVA Talks afterparty', 'KAVA Talks'), 0)
  assert.equal(titleScore('Partnership Discussion notes 2026', 'Partnership Discussion'), 0)
})

test('the stopwords do not spend the three-word budget', () => {
  // "Meeting w/ Hannah" is a real subject: 3 raw tokens, 1 that identifies
  // anybody. Containment must refuse it.
  assert.deepEqual(significantTokens('Meeting w/ Hannah'), ['hannah'])
  assert.equal(titleScore('2026-08-24 Meeting w/ Hannah recording', 'Meeting w/ Hannah'), 0)
})

test('a place name is never a stopword', () => {
  // §12: keep PLACE names out of the stopword list — the deal's name is the
  // whole signal. "Tooele Delta site" must stay three significant words.
  assert.equal(significantTokens('Tooele Delta site').length, 3)
})

test('two titles that share no words do not match', () => {
  assert.equal(titleScore('Lunch and discussion', 'Ber Wilson meeting w Brent Bennett'), 0)
})

// ── The clock bar ───────────────────────────────────────────────────────────

/** The real 23 October pair, which is also the shape that broke a symmetric slack. */
const noon = event({
  subject: 'Ber Wilson meeting w Brent Bennett',
  start: '2026-10-23T12:30:00-06:00',
  end: '2026-10-23T13:30:00-06:00',
  attendees: [
    { name: 'r', email: 'moose@berwilson.com', response: 'accepted', optional: false },
    { name: 'b', email: 'brent@getbennett.com', response: 'accepted', optional: false },
  ],
  organizer: { name: 'r', email: 'moose@berwilson.com' },
})
const prep = event({
  subject: 'Prep for Ber Wilson meeting w Brent Bennett',
  start: '2026-10-23T12:15:00-06:00',
  end: '2026-10-23T12:30:00-06:00',
  organizer: { name: 'r', email: 'moose@berwilson.com' },
})

test('a recording started inside the event is inside; one an hour later is not', () => {
  assert.equal(clockContains(noon, '2026-10-23T12:35:00-06:00'), 'inside')
  assert.equal(clockContains(noon, '2026-10-23T14:30:00-06:00'), null)
})

test('the span is half-open, so back-to-back blocks do not both claim a moment', () => {
  // 12:30 is the meeting's first instant and one past the prep block's last.
  assert.equal(clockContains(noon, '2026-10-23T12:30:00-06:00'), 'inside')
  assert.equal(clockContains(prep, '2026-10-23T12:30:00-06:00'), null, 'the prep block has ended')
  assert.equal(clockContains(prep, '2026-10-23T12:29:00-06:00'), 'inside')
  assert.equal(clockContains(prep, '2026-10-23T12:35:00-06:00'), null)
})

test('the slack reaches the quarter-hour before the start and no further', () => {
  assert.equal(clockContains(noon, '2026-10-23T12:20:00-06:00'), 'lead')
  assert.equal(clockContains(noon, '2026-10-23T12:10:00-06:00'), null)
})

test('an all-day event never contains a recording', () => {
  const allDay = event({ subject: 'Offsite', start: '2026-10-23', end: '2026-10-24', isAllDay: true })
  assert.equal(clockContains(allDay, '2026-10-23T12:35:00-06:00'), null)
})

test('a block with nobody but its organizer is not a meeting', () => {
  assert.equal(hasInvitees(prep), false)
  assert.equal(hasInvitees(noon), true)
})

test('the prep block does not make its own meeting ambiguous', () => {
  // The live calendar shape, verified end to end: a 15-minute prep block ending
  // exactly when the meeting starts. Before the half-open span and the
  // solo-block rule, these two tied and the join was refused.
  const got = matchRecordingToEvent({
    title: '20261023 123500',
    clock: { recordedAt: '2026-10-23T12:35:00-06:00', exact: true },
    events: [prep, noon],
  })
  assert.equal(got?.event.subject, 'Ber Wilson meeting w Brent Bennett')
  assert.equal(got?.via, 'clock')
})

// ── The join ────────────────────────────────────────────────────────────────

test('an inexact clock may not match on time alone', () => {
  // A Drive upload time landing inside an unrelated afternoon is the whole
  // reason `exact` exists.
  const got = matchRecordingToEvent({
    title: 'voice 004',
    clock: { recordedAt: '2026-10-23T12:35:00-06:00', exact: false },
    events: [noon],
  })
  assert.equal(got, null)
})

test('an exact clock matches on time alone — the voice-memo case', () => {
  const got = matchRecordingToEvent({
    title: '20261023 123500',
    clock: { recordedAt: '2026-10-23T12:35:00-06:00', exact: true },
    events: [noon],
  })
  assert.equal(got?.event.subject, 'Ber Wilson meeting w Brent Bennett')
  assert.equal(got?.via, 'clock')
})

test('title and clock agreeing is reported as both', () => {
  const got = matchRecordingToEvent({
    title: 'Ber Wilson meeting w Brent Bennett',
    clock: { recordedAt: '2026-10-23T12:35:00-06:00', exact: true },
    events: [noon],
  })
  assert.equal(got?.via, 'title+clock')
})

test('two events contain the recording, so neither is the meeting', () => {
  const overlapping = event({
    subject: 'Something else entirely',
    start: '2026-10-23T12:00:00-06:00',
    end: '2026-10-23T14:00:00-06:00',
    attendees: [{ name: 'x', email: 'x@example.com', response: 'accepted', optional: false }],
  })
  const got = matchRecordingToEvent({
    title: '20261023 123500',
    clock: { recordedAt: '2026-10-23T12:35:00-06:00', exact: true },
    events: [noon, overlapping],
  })
  assert.equal(got, null, 'ambiguity must mean no match')
})

test('a title match beats a bare clock overlap rather than tying with it', () => {
  const overlapping = event({
    subject: 'Double-booked with someone else',
    start: '2026-10-23T12:00:00-06:00',
    end: '2026-10-23T14:00:00-06:00',
    attendees: [{ name: 'x', email: 'x@example.com', response: 'accepted', optional: false }],
  })
  const got = matchRecordingToEvent({
    title: 'Ber Wilson meeting w Brent Bennett',
    clock: { recordedAt: '2026-10-23T12:35:00-06:00', exact: true },
    events: [overlapping, noon],
  })
  assert.equal(got?.event.subject, 'Ber Wilson meeting w Brent Bennett')
})

test('nothing matches when the recording names nothing and the clock is a fallback', () => {
  const got = matchRecordingToEvent({
    title: 'New Recording 7',
    clock: { recordedAt: '2026-10-27T09:00:00-06:00', exact: false },
    events: [noon],
  })
  assert.equal(got, null)
})

// ── The window ──────────────────────────────────────────────────────────────

test('an inexact clock searches backward, because a file is dragged in late', () => {
  const { timeMin, timeMax } = searchWindow({ recordedAt: '2026-10-27T00:00:00Z', exact: false })
  const back = (Date.parse('2026-10-27T00:00:00Z') - Date.parse(timeMin)) / 86_400_000
  const fwd = (Date.parse(timeMax) - Date.parse('2026-10-27T00:00:00Z')) / 86_400_000
  assert.equal(back, FALLBACK_LOOKBACK_DAYS)
  assert.equal(fwd, FALLBACK_LOOKAHEAD_DAYS)
  assert.ok(back > fwd, 'a conversation cannot post-date the file that holds it')
  // And the window must still reach the measured case: the file landed on the
  // 27th, the meeting was on the 23rd.
  assert.ok(Date.parse(timeMin) <= Date.parse('2026-10-23T18:30:00Z'))
})

test('an exact clock searches a day either side', () => {
  const { timeMin, timeMax } = searchWindow({ recordedAt: '2026-10-23T12:00:00Z', exact: true })
  assert.equal(timeMin, '2026-10-22T12:00:00.000Z')
  assert.equal(timeMax, '2026-10-24T12:00:00.000Z')
})

// ── Dedupe across the two mailboxes ─────────────────────────────────────────

test('one meeting on both calendars is one event, with the attendees merged', () => {
  const mine = event({
    id: 'mnlfi3ibcl877ev0ke6b8akqmo',
    subject: 'Ber Wilson meeting w Brent Bennett',
    start: '2026-10-23T12:30:00-06:00',
    end: '2026-10-23T13:30:00-06:00',
    attendees: [{ name: 'a', email: 'moose@berwilson.com', response: 'accepted', optional: false }],
  })
  const theirs = event({
    ...mine,
    attendees: [{ name: 'b', email: 'brent@getbennett.com', response: 'accepted', optional: false }],
  })
  const got = dedupeCalendarEvents([mine, theirs])
  assert.equal(got.length, 1)
  assert.deepEqual(got[0].attendees.map((a) => a.email).sort(), [
    'brent@getbennett.com',
    'moose@berwilson.com',
  ])
})

// ── The union onto the row ──────────────────────────────────────────────────

test('an invitee the transcript missed is added, not dropped', () => {
  const got = unionAssertedAttendees(
    [attendee({ name: 'Damon', role: 'GC principal' })],
    [attendee({ name: 'Brent Bennett', email: 'brent@getbennett.com', party_id: 'p1' })]
  )
  assert.equal(got.length, 2)
  assert.equal(got[1].name, 'Brent Bennett')
  assert.equal(got[1].party_id, 'p1')
})

test('an invitee the transcript heard under a worse name takes the invitation’s', () => {
  // The measured row: a slot called "Richard White" carrying the Ber Wilson
  // ORGANIZATION's party id, because a fuzzy match on "Ber Wilson Executive"
  // stayed attached while a human renamed the slot.
  const got = unionAssertedAttendees(
    [attendee({ name: 'Richard White', role: 'Ber Wilson EVP', party_id: 'the-company' })],
    [attendee({ name: 'Richard White', email: 'moose@berwilson.com', party_id: 'richard', org: 'Ber Wilson' })]
  )
  assert.equal(got.length, 1)
  assert.equal(got[0].party_id, 'richard', 'the invitation is a fact and the slot is a reading')
  assert.equal(got[0].email, 'moose@berwilson.com')
  assert.equal(got[0].role, 'Ber Wilson EVP', 'the model’s role survives — the calendar has none')
})

test('the address folds two spellings of one person into one row', () => {
  const got = unionAssertedAttendees(
    [attendee({ name: 'Rich', email: 'MOOSE@berwilson.com' })],
    [attendee({ name: 'Richard White', email: 'moose@berwilson.com', party_id: 'richard' })]
  )
  assert.equal(got.length, 1)
  assert.equal(got[0].name, 'Richard White')
})

test('nothing asserted leaves the heard list exactly as it was', () => {
  const heard = [attendee({ name: 'Damon', role: 'GC principal' })]
  assert.deepEqual(unionAssertedAttendees(heard, null), heard)
  assert.deepEqual(unionAssertedAttendees(heard, []), heard)
})

// ── The size bound ──────────────────────────────────────────────────────────

test('the invitee bound admits every real meeting measured and no broadcast', () => {
  // ⚠ PINNED TO THE MEASUREMENT, NOT TO THE NUMBER. 2026's two executive
  // calendars: the largest genuine deal meetings carry 12 invitees
  // (Ber Wilson/TensorIQ/Elite Solutions, the prefab factory tour, two Vultr
  // calls); the next size up is 14, which is 28 occurrences of one recurring
  // community event, and above that only conferences. Re-measure before
  // moving this — §12: a threshold is measured against the real corpus, never
  // chosen, and nudging it is how the corpus stops being the reason.
  const largestRealMeeting = 12
  const smallestBroadcast = 14
  assert.ok(SMALL_MEETING_INVITEES >= largestRealMeeting, 'a real deal call must keep its people')
  assert.ok(SMALL_MEETING_INVITEES < smallestBroadcast, 'a broadcast must not fill the contacts queue')
})
