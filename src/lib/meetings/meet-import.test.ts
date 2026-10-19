/**
 * Meet file names, which are a vendor's UI strings and not an API contract.
 *
 * ⚠ THIS FILE EXISTS BECAUSE A MISSING SUFFIX MADE A COUNT LIE. Measured
 * 2026-10-19: the importer reported *"2 recording(s) have no transcript beside
 * them"* on every run while both recordings sat next to their own imported
 * `… - Notes by Gemini` document — because `Recording` was absent from the
 * suffix list that defines a meeting's key, so the recording's key kept its
 * ` - Recording` tail and could never equal the notes document's. The same list
 * is written out twice (here and in `google-drive.ts`), which is why both are
 * pinned.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { meetingTitleFromFileName } from './meet-import'

test('all three artifact suffixes come off, and the title survives', () => {
  // The two stamping conventions Meet has used, both live in one Drive.
  assert.equal(
    meetingTitleFromFileName('Ber Wilson/TensorIQ/Elite Solutions - 2026/09/25 10:58 MDT - Notes by Gemini'),
    'Ber Wilson/TensorIQ/Elite Solutions'
  )
  assert.equal(
    meetingTitleFromFileName('Synetra/Ber Wilson Discussion (2026-10-19 10:00 GMT-6) - Transcript'),
    'Synetra/Ber Wilson Discussion'
  )
  // ⚠ The one that was missing. A recording and its notes must reduce to the
  // SAME title, or the importer reports a transcript-less recording that has
  // a transcript.
  assert.equal(
    meetingTitleFromFileName('Ber Wilson chat W Taylor - 2026/10/12 09:00 MDT - Recording'),
    'Ber Wilson chat W Taylor'
  )
})

test('a recording and its Gemini notes reduce to one title', () => {
  const stem = 'Ber Wilson / Zenthium - 2026/09/29 13:57 MDT'
  assert.equal(
    meetingTitleFromFileName(`${stem} - Recording`),
    meetingTitleFromFileName(`${stem} - Notes by Gemini`)
  )
})

test('the slashes in a title are left alone — they are the filing key', () => {
  // "Ber Wilson/TensorIQ/Elite Solutions" is what the organizer typed, and
  // that path is the strongest filing signal the platform gets.
  assert.match(
    meetingTitleFromFileName('Ber Wilson/Tensor Discuss Uintah Basin - 2026/10/07 07:57 MDT - Notes by Gemini'),
    /^Ber Wilson\/Tensor Discuss Uintah Basin$/
  )
})

test('a name that is nothing but a stamp returns itself rather than empty', () => {
  // `|| name` at the end: an empty title would file a real call under "".
  const code = 'fxw-xtyp-jrb (2026-06-16 18:51 GMT)'
  assert.ok(meetingTitleFromFileName(code).length > 0)
})
