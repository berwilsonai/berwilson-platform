/**
 * The small decisions in the upload door that are easy to get wrong silently.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isUploadThread, uploadThreadId, UPLOAD_THREAD_PREFIX } from './upload'
import { isVoiceMemoThread, VOICEMEMO_THREAD_PREFIX } from '@/lib/voicememos/to-thread'
import { isDriveAudioThread, DRIVE_AUDIO_THREAD_PREFIX } from '@/lib/driveaudio/to-thread'
import { isLocalThread, threadSource } from '@/lib/email-sweep/thread-source'
import { meetingRefFromThreadId } from '@/lib/meetings/attach-recording'

test('an upload thread is recognisable by its prefix', () => {
  const id = uploadThreadId('abc123')
  assert.equal(id, 'upload:abc123')
  assert.ok(isUploadThread(id))
})

test('and it is NOT mistaken for either other recording door', () => {
  // ⚠ These three prefixes are a discriminator, and `meetingRefFromThreadId`
  // branches on them. A prefix that overlapped would file one door's recording
  // through another's parser.
  const id = uploadThreadId('abc123')
  assert.equal(isVoiceMemoThread(id), false)
  assert.equal(isDriveAudioThread(id), false)
  assert.equal(isUploadThread('voicememo:ABC'), false)
  assert.equal(isUploadThread('driveaudio:ABC'), false)
  assert.equal(UPLOAD_THREAD_PREFIX, 'upload')
})

test('a null or empty id is not an upload thread', () => {
  // Called on `email_threads.gmail_thread_id`, which is nullable.
  assert.equal(isUploadThread(null), false)
  assert.equal(isUploadThread(undefined), false)
  assert.equal(isUploadThread(''), false)
})

test('two uploads of the same file get different fingerprints', () => {
  // ⚠ DELIBERATE, AND THE OPPOSITE OF THE DRIVE DOOR. There the file id is the
  // guard against reading one export twice; here a re-upload is how a person
  // corrects a recording that went onto the wrong record, so a content hash
  // would make the correction a silent no-op.
  const a = uploadThreadId(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
  const b = uploadThreadId(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
  assert.notEqual(a, b)
})

// ─── the three prefix switches must all know this door ──────────────────────
//
// ⚠ THIS IS THE TEST THAT WAS MISSING, and its absence cost two full
// verification runs. Adding `upload:` as a fourth recording prefix needed an
// arm in THREE separate switches, and only one of them was obvious:
//
//   1. `meetingRefFromThreadId` — the meeting's storage key. Missed first.
//   2. `threadSource` — the source classification, and the real root cause:
//      `fileMeetingFromThreadLinks` opens with `source !== 'call' && source
//      !== 'recording'`, so an unrecognised prefix falls through to `email`
//      and the entire filing step is skipped in silence.
//   3. `LOCAL_THREAD_PREFIXES` — "there is no Gmail thread behind this row",
//      which keeps a synthetic id out of a live Gmail fetch.
//
// A prefix discriminator is a registry with no type behind it, so nothing makes
// the compiler ask. This asserts it instead, for every door at once — which is
// what makes the FIFTH recorder cheap.

test('every recording door classifies as a recording, and none as email', () => {
  const ids = [
    uploadThreadId('abc123'),
    `${VOICEMEMO_THREAD_PREFIX}26229FF4-2EED-424D-8EAD-885D4605FF0C`,
    `${DRIVE_AUDIO_THREAD_PREFIX}1t4D8sp9CVVt8hK50GejmUBC6YO5mKwlb`,
  ]
  for (const id of ids) {
    assert.equal(threadSource(id, 'Site walk note'), 'recording', id)
    // The gate in `fileMeetingFromThreadLinks` is this exact test.
    assert.notEqual(threadSource(id, 'Site walk note'), 'email', id)
  }
})

test('every recording door yields a meeting key, never null', () => {
  // null here means `fileMeetingFromThreadLinks` cannot find the row to move,
  // and the meeting stays unfiled under a correctly linked thread.
  for (const id of [
    uploadThreadId('abc123'),
    `${VOICEMEMO_THREAD_PREFIX}26229FF4`,
    `${DRIVE_AUDIO_THREAD_PREFIX}1t4D8sp`,
  ]) {
    assert.equal(meetingRefFromThreadId(id), id, id)
  }
})

test('every recording door is a LOCAL thread, so no Gmail fetch is attempted', () => {
  for (const id of [
    uploadThreadId('abc123'),
    `${VOICEMEMO_THREAD_PREFIX}26229FF4`,
    `${DRIVE_AUDIO_THREAD_PREFIX}1t4D8sp`,
  ]) {
    assert.ok(isLocalThread(id), id)
  }
  // And a real Gmail id is not.
  assert.equal(isLocalThread('1a155bcdb822f418'), false)
})
