/**
 * One call, several deals — what each record's feed is allowed to say.
 *
 * The three fallbacks are the point. A per-deal entry is only safe because the
 * whole call is still filed as a document on every record, so the failure to
 * guard against is writing NOTHING, or writing a slice that does not admit it
 * is one.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { feedBody, recordFeedBody, meetingDoc, type MeetingMeta } from './feed'

const CALL: MeetingMeta = {
  title: 'Steelton & Riverdale site reviews',
  date: '2026-09-29',
  summary: 'Rebecca presented a portfolio of powered land across PA, IL and WV.',
  minutes: 'The group reviewed Steelton, then Riverdale, then the Weirton walk-through.',
  decisions: ['Pursue Steelton at the 1 Nov closing.'],
}

// Taken verbatim from the real recap of that call (2026-10-14).
const STEELTON = '~280 acres across two parcels in Steelton, PA. PPL substation currently holds 420 MW.'
const RIVERDALE = 'Located near Chicago, IL, 28 miles from downtown. Extensive rail yards and dark fiber.'

test('each record gets its own paragraph, not the whole call', () => {
  const steelton = recordFeedBody(CALL, { discussion: STEELTON }, ['Riverdale — Cleveland-Cliffs (IL)'])
  assert.ok(steelton.includes('280 acres'), 'Steelton keeps its own facts')
  assert.ok(!steelton.includes('Weirton walk-through'), 'and not the other deals’ narrative')
  assert.ok(!steelton.includes(RIVERDALE))

  const riverdale = recordFeedBody(CALL, { discussion: RIVERDALE }, ['Steelton — Cleveland-Cliffs (PA)'])
  assert.ok(riverdale.includes('28 miles from downtown'))
  assert.ok(!riverdale.includes('280 acres'))
})

test('a slice says that it is one, and names what else the call covered', () => {
  // Without this the reader believes the call was only about this deal — and a
  // one-paragraph entry about a two-hour call reads as a thin record, not a slice.
  const body = recordFeedBody(CALL, { discussion: STEELTON }, ['Riverdale', 'Weirton'])
  assert.match(body, /also covered Riverdale, Weirton/)
  assert.match(body, /full minutes are in the attached meeting notes/)
})

test('the only record on the call gets no "also covered" line', () => {
  const body = recordFeedBody(CALL, { discussion: STEELTON }, [])
  assert.ok(!body.includes('also covered'))
  assert.ok(body.startsWith('~280 acres'))
})

test('decisions reach every record, because a decision is the call’s', () => {
  const body = recordFeedBody(CALL, { discussion: STEELTON }, ['Riverdale'])
  assert.match(body, /Pursue Steelton at the 1 Nov closing\./)
})

test('no per-deal text falls back to the WHOLE call, never to nothing', () => {
  // Three cases, one shape: a session staged before prompt 1.2, a target the
  // reviewer added by hand, and a deal the recap judged merely mentioned.
  for (const target of [{}, { discussion: null }, { discussion: '   ' }]) {
    const body = recordFeedBody(CALL, target, ['Riverdale'])
    assert.equal(body, feedBody(CALL), `fell back for ${JSON.stringify(target)}`)
    assert.ok(body.includes('Weirton walk-through'), 'the fallback is the whole call')
  }
})

test('the attached document carries the whole call and names the deals in it', () => {
  const doc = meetingDoc(CALL, [{ name: 'Rebecca Leonardi', role: 'Land portfolio' }], [
    'Steelton — Cleveland-Cliffs (PA)',
    'Riverdale — Cleveland-Cliffs (IL)',
  ])
  assert.match(doc, /This call covered 2 records:/)
  assert.ok(doc.includes('Weirton walk-through'), 'the whole narrative is here')
  assert.ok(doc.includes('Rebecca Leonardi'))
})

test('a document on a single record claims nothing about other deals', () => {
  const doc = meetingDoc(CALL, [], ['Steelton — Cleveland-Cliffs (PA)'])
  assert.ok(!doc.includes('This call covered'))
})
