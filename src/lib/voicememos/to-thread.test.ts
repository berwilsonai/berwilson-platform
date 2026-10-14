/**
 * A recording's thread id is its idempotency key, and a rename must not change it.
 *
 * ⚠ THE BUG THIS PINS COSTS 30 SECONDS OF WHISPER AND A DUPLICATE RECORD EVERY
 * TIME. `noteToThread` deliberately puts the note's modification time in the
 * thread id, so editing a note produces a new row and re-summarizes — right for
 * a living document. Copying that here would mean renaming a memo (which is the
 * one thing a human is encouraged to do, because a memo named after the deal
 * files itself) re-transcribed the same audio and staged a second meeting for
 * the same conversation.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isVoiceMemoThread, memoThreadId, memoToThread } from '@/lib/voicememos/to-thread'
import type { MemoRow } from '@/lib/voicememos/read'

function memo(overrides: Partial<MemoRow> = {}): MemoRow {
  return {
    identifier: 'A1B2C3',
    title: 'Steelton site walk',
    createdAt: '2026-10-14T16:30:00.000Z',
    durationSeconds: 2_700,
    audioPath: '/tmp/voice-memos/20261014 103000.m4a',
    fileName: '20261014 103000.m4a',
    folder: null,
    ...overrides,
  }
}

test('the thread id carries the identifier and nothing else', () => {
  assert.equal(memoThreadId('A1B2C3'), 'voicememo:A1B2C3')
  const renamed = memoToThread(memo({ title: 'Steelton PSA — closing call' }), 'words')
  const original = memoToThread(memo(), 'words')
  assert.equal(renamed.threadId, original.threadId)
  assert.equal(renamed.fingerprint, original.fingerprint)
})

test('the thread is dated when the recording was MADE', () => {
  // Not when iCloud synced it: the whole pipeline reads `last_at` as when the
  // conversation happened, and a meeting filed with the sync time sorts above
  // the correspondence that came after it.
  const t = memoToThread(memo(), 'words')
  assert.equal(t.firstAt, '2026-10-14T16:30:00.000Z')
  assert.equal(t.lastAt, '2026-10-14T16:30:00.000Z')
  assert.equal(t.messages[0].receivedAt, '2026-10-14T16:30:00.000Z')
})

test('the title leads the body, because it is the only metadata a recording has', () => {
  // The summarizer and the router both read this text, and a memo named after
  // the deal is the cheapest filing signal there is.
  const t = memoToThread(memo(), 'We walked the east parcel with the seller.')
  assert.ok(t.messages[0].bodyText.startsWith('Steelton site walk'))
  assert.ok(t.messages[0].bodyText.includes('45 min'))
  assert.ok(t.messages[0].bodyText.includes('east parcel'))
})

test('an unnamed recording still gets a subject a reader can scan', () => {
  const t = memoToThread(memo({ title: '' }), 'words')
  assert.equal(t.subject, '(untitled recording)')
})

test('participants are the owner alone — never guessed from the transcript', () => {
  // The enrichment pass matches participants against `parties` as fact, so a
  // cast invented from whoever introduced themselves would be asserted. Who was
  // in the room is the recap's job, staged for a human.
  const t = memoToThread(memo(), 'Richard here, with Eric and Merlin Corbin.')
  assert.equal(t.participants.length, 1)
  assert.ok(isVoiceMemoThread(t.threadId))
})
