/**
 * The contact feed's two rules that nothing else can catch.
 *
 * ⚠ BOTH OF THESE ARE HERE BECAUSE A LIVE ROUND TRIP FOUND THEM AND `tsc`, the
 * build and 639 other tests did not. The first is a PostgREST call shape; the
 * second is what a conversation reads as on a profile. Neither is expressible as
 * a type, and the first reported SUCCESS at every layer above it while writing
 * nothing — a contact linked to three recorded calls with an empty feed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backfillContactFeed, meetingNoteBody } from './notes'

// ─── The filter shape ────────────────────────────────────────────────────────

test('the jsonb containment filter is handed a STRING, never an array', async () => {
  // ⚠ WHY THIS IS A TEST AND NOT A COMMENT. `supabase-js` renders an Array
  // argument to `.contains()` as a POSTGRES array literal — `{a,b}` — so an
  // array of objects becomes the literal `{[object Object]}` and Postgres
  // answers `invalid input syntax for type json`. The caller logs it and
  // returns `{written: 0}`, which is indistinguishable from "this contact has
  // been on no calls". A string is forwarded verbatim, which is what jsonb `cs`
  // wants. Anyone "simplifying" this back to the array form reintroduces a
  // silent no-op, so the call shape is asserted rather than described.
  let seen: unknown = Symbol('never called')
  const fake = {
    from: () => ({
      select: () => ({
        contains: (_col: string, value: unknown) => {
          seen = value
          return Promise.resolve({ data: [], error: null })
        },
      }),
    }),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a stub client
  const result = await backfillContactFeed(fake as any, 'party-1')

  assert.equal(typeof seen, 'string', 'the filter value must be a JSON string')
  assert.deepEqual(JSON.parse(seen as string), [{ party_id: 'party-1' }])
  assert.deepEqual(result, { written: 0, meetings: 0 })
})

// ─── What a conversation reads as ────────────────────────────────────────────

test('the recap is what lands, with the summary preferred over the minutes', () => {
  const body = meetingNoteBody({
    id: 'm1',
    title: 'Ber Wilson/Tensor Discuss Uintah Basin',
    meeting_date: '2026-10-07',
    summary: 'Agreed to send the term sheet.',
    minutes: 'A much longer verbatim set of minutes.',
    scope: 'opportunity',
    kind: 'call',
  })
  assert.equal(body, 'Recorded call — Ber Wilson/Tensor Discuss Uintah Basin\n\nAgreed to send the term sheet.')
})

test('the minutes carry it when there is no summary', () => {
  const body = meetingNoteBody({
    id: 'm1', title: 'Coffee with the county', meeting_date: '2026-10-07',
    summary: null, minutes: 'Zoning timeline discussed.', scope: 'contact', kind: 'other',
  })
  assert.equal(body, 'Meeting — Coffee with the county\n\nZoning timeline discussed.')
})

test('a meeting with no recap writes nothing rather than an empty note', () => {
  // ⚠ A RECORDING IS REGISTERED BEFORE ITS RECAP EXISTS, so this is the normal
  // early state and not an error. Writing a heading with no body would put a
  // note on somebody's profile that says only that a call happened — which the
  // `meeting_attended` projection already says, and which §12 names as a bare
  // value at a reader's own weight reading like a failed render.
  assert.equal(
    meetingNoteBody({
      id: 'm1', title: 'A call', meeting_date: '2026-10-07',
      summary: null, minutes: null, scope: 'unfiled', kind: 'call',
    }),
    null,
  )
  // And an all-whitespace recap is no recap.
  assert.equal(
    meetingNoteBody({
      id: 'm1', title: 'A call', meeting_date: '2026-10-07',
      summary: '   ', minutes: '\n\n', scope: 'unfiled', kind: 'call',
    }),
    null,
  )
})

test('an untitled recording still says what kind of thing it was', () => {
  assert.equal(
    meetingNoteBody({
      id: 'm1', title: null, meeting_date: '2026-10-07',
      summary: 'Talked about the Delta parcel.', minutes: null, scope: 'contact', kind: 'site_visit',
    }),
    'Site visit\n\nTalked about the Delta parcel.',
  )
})
