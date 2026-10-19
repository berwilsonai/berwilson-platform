/**
 * The Drive audio source's three load-bearing decisions, pinned.
 *
 * ⚠ EACH ONE IS A BUG THIS CODEBASE HAS ALREADY PAID FOR ONCE, IN ANOTHER
 * SOURCE. The thread id must survive a rename (the Notes path re-transcribed
 * one 16-minute call four times a day because its id carried a stamp); the
 * date must come from the recording and not the upload (a memo filed under its
 * sync time sorts above the mail that answered it); and the participants must
 * be the owner alone (a cast invented from whoever introduced themselves on the
 * audio is matched against `parties` as fact).
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  driveAudioSubject,
  driveAudioThreadId,
  driveAudioToThread,
  isDriveAudioThread,
} from '@/lib/driveaudio/to-thread'
import { recordedAtFromName, type DriveAudioRow } from '@/lib/driveaudio/read'
import { threadSource, isLocalThread } from '@/lib/email-sweep/thread-source'
import { isRecordingFileName } from '@/lib/utils/meetings'

function file(overrides: Partial<DriveAudioRow> = {}): DriveAudioRow {
  return {
    fileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
    title: '2026-10-18 103000',
    fileName: '2026-10-18 103000.mp3',
    mimeType: 'audio/mpeg',
    recordedAt: '2026-10-18T16:30:00.000Z',
    recordedAtSource: 'file-name',
    sizeBytes: 12_300_000,
    folderHint: null,
    webViewLink: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view',
    ...overrides,
  }
}

test('the thread id is the Drive file id, which survives a rename and a move', () => {
  // Drive keeps the id across both, which is the whole reason it is the key:
  // renaming the file after the deal is the gesture that files it, and it must
  // not cost a second transcription and a duplicate meeting.
  assert.equal(driveAudioThreadId('abc123'), 'driveaudio:abc123')
  const renamed = driveAudioToThread(file({ title: 'Steelton PSA closing call' }), 'words')
  const moved = driveAudioToThread(file({ folderHint: 'Steelton' }), 'words')
  const original = driveAudioToThread(file(), 'words')
  assert.equal(renamed.threadId, original.threadId)
  assert.equal(moved.fingerprint, original.fingerprint)
})

test('the subfolder leads the subject, because a timestamped export names no deal', () => {
  const t = driveAudioToThread(file({ folderHint: 'Steelton' }), 'words')
  assert.equal(t.subject, 'Steelton — 2026-10-18 103000')
  // And it is in the TEXT as well as the subject: route-phase reads
  // `raw_markdown`, so a hint only in the subject would not reach the matcher.
  assert.ok(t.messages[0].bodyText.startsWith('Steelton — 2026-10-18 103000'))
  assert.ok(t.messages[0].bodyText.includes('under "Steelton"'))
})

test('a file at the top of the folder keeps its own name as the subject', () => {
  assert.equal(driveAudioSubject(file()), '2026-10-18 103000')
  assert.equal(driveAudioSubject(file({ title: '' })), '(untitled recording)')
})

test('the thread is dated when the conversation happened, not when it uploaded', () => {
  const t = driveAudioToThread(file(), 'words')
  assert.equal(t.firstAt, '2026-10-18T16:30:00.000Z')
  assert.equal(t.lastAt, '2026-10-18T16:30:00.000Z')
  assert.equal(t.messages[0].receivedAt, '2026-10-18T16:30:00.000Z')
})

test('participants are the owner alone — never read off the transcript', () => {
  const t = driveAudioToThread(file(), 'Richard here, with Merlin Corbin and Paul Finan.')
  assert.equal(t.participants.length, 1)
  assert.equal(t.attachmentCount, 0)
})

test('the source is a `recording` and a LOCAL thread, in the one place that is asked', () => {
  // ⚠ The whole point of thread-source.ts. Without the prefix named there, this
  // reads as `email`: the feed says "Email — Steelton — 2026-10-18" and
  // `importThreadAttachments` sends a synthetic id to a live Gmail fetch.
  const id = driveAudioThreadId('abc123')
  assert.ok(isDriveAudioThread(id))
  assert.equal(threadSource(id), 'recording')
  assert.equal(isLocalThread(id), true)
  // And it is not confused with the other sources' ids.
  assert.equal(isDriveAudioThread('voicememo:abc'), false)
  assert.equal(isDriveAudioThread(null), false)
})

test('a date in the file name is read, in the shapes exporters actually write', () => {
  for (const name of [
    '2026-10-18 10-30-00.mp3',
    '20261018_103000.m4a',
    'Plaude 2026-10-18T10.30.mp3',
    'Recording 2026-10-18 at 10.30.wav',
  ]) {
    const iso = recordedAtFromName(name)
    assert.ok(iso, `${name} should parse`)
    const d = new Date(iso!)
    assert.equal(d.getFullYear(), 2026)
    assert.equal(d.getMonth(), 9)
    assert.equal(d.getDate(), 18)
    assert.equal(d.getHours(), 10)
    assert.equal(d.getMinutes(), 30)
  }
})

test('a date-only name lands at midday, not at midnight', () => {
  // ⚠ Never `new Date('YYYY-MM-DD')`, which is UTC midnight and lands the
  // previous evening in Mountain Time — the bug class the meetings module
  // keeps its dates as strings to avoid. Midday also stops a date-only
  // recording sorting below everything else that happened that day.
  const iso = recordedAtFromName('Steelton 2026-10-18.mp3')
  assert.ok(iso)
  const d = new Date(iso!)
  assert.equal(d.getDate(), 18)
  assert.equal(d.getHours(), 12)
})

test('something that merely looks like eight digits is NOT a date', () => {
  // Any eight digits in a file name look like a date — an invoice number, a
  // parcel id, a solicitation number. A parse that cannot refuse is worth less
  // than one that can, because the fallback (Drive's own time) is honest.
  assert.equal(recordedAtFromName('Invoice 99881234.mp3'), null)
  assert.equal(recordedAtFromName('Steelton PSA call.mp3'), null)
  // A rolled-over impossible day would otherwise become a confident wrong date
  // (the Date constructor turns Feb 30 into Mar 2).
  assert.equal(recordedAtFromName('2026-02-30 1030.mp3'), null)
  assert.equal(recordedAtFromName('2026-13-01 1030.mp3'), null)
  // And a recording cannot have happened after today.
  assert.equal(recordedAtFromName('2099-01-01 1030.mp3'), null)
  // Nor before this platform or its deals existed.
  assert.equal(recordedAtFromName('2014-01-01 1030.mp3'), null)
})

test('the transcribable-container list is one list, and it knows mp3 and qta', () => {
  // ⚠ `.qta` is the one that cost real hours: a recent iOS writes it, there was
  // no branch for it, and 39 of 111 voice memos — every 2026 recording —
  // read as a quiet corpus. The picker and this sweep must never hold two lists.
  assert.ok(isRecordingFileName('call.mp3'))
  assert.ok(isRecordingFileName('MEMO.QTA'))
  assert.ok(isRecordingFileName('site walk.mov'))
  assert.equal(isRecordingFileName('contract.pdf'), false)
  assert.equal(isRecordingFileName('transcript.txt'), false)
  assert.equal(isRecordingFileName(null), false)
})
