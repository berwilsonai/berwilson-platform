/**
 * Where a thread came from, asked once.
 *
 * ⚠ THESE TESTS ARE THE RULE'S ENFORCEMENT, NOT ITS DECORATION. The same bug
 * shipped three times — texts got a provenance arm on 10-11, notes and calls on
 * 10-14 after a project's feed was found reading "Email — Call with Eric
 * Tuaone", and a voice memo would have been the fourth. The closed union makes
 * the BUILD fail when a source is added without an arm; these pin the answers
 * that a type cannot check: which prefix means what, and which of them get the
 * "Email —" heading.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isLocalThread,
  LOCAL_THREAD_PREFIXES,
  threadSource,
  threadSourceLabel,
  threadUpdateHeading,
} from '@/lib/email-sweep/thread-source'

test('each prefix resolves to its own source', () => {
  assert.equal(threadSource('18f2a9c4b1e7', 'Re: Steelton PSA'), 'email')
  assert.equal(threadSource('imessage:chat123:4', 'Texts with Eric — 10-11'), 'imessage')
  assert.equal(threadSource('note:ABC-123:2026-10-12T09:00:00', 'Alaska offer'), 'note')
  assert.equal(threadSource('voicememo:ABC-123', 'Steelton site walk'), 'recording')
})

test('a note carrying iOS’s own call title is a CALL, not a note', () => {
  // The distinction cannot come from the prefix: both arrive through Apple
  // Notes. iOS writes this exact title form and the note must also carry audio
  // (tested at the source in notes/calls.ts), which is what makes a title match
  // admissible here where §12 forbids it for matching records.
  assert.equal(threadSource('note:X:2026-10-12T09:00:00', 'Call with Eric Tuaone'), 'call')
  assert.equal(threadSource('note:X:2026-10-12T09:00:00', 'call with the bank'), 'call')
})

test('a missing subject degrades a call to a note, never to email', () => {
  // The failure to avoid is a LOCAL thread being called mail, because that is
  // the sentence that outlives the thread on a project's feed.
  assert.equal(threadSource('note:X:2026-10-12T09:00:00', null), 'note')
  assert.equal(threadSource('note:X:2026-10-12T09:00:00', undefined), 'note')
})

test('a null thread id is mail, and nothing else is', () => {
  assert.equal(threadSource(null), 'email')
  assert.equal(threadSource(undefined), 'email')
})

test('every local prefix is recognised as local', () => {
  for (const prefix of LOCAL_THREAD_PREFIXES) {
    assert.ok(isLocalThread(`${prefix}whatever`), `${prefix} should be local`)
    assert.notEqual(
      threadSource(`${prefix}whatever`, 'x'),
      'email',
      `${prefix} must never resolve to email`
    )
  }
  // A real Gmail thread id is not local — this is the test that stops
  // `importThreadAttachments` skipping actual mail.
  assert.equal(isLocalThread('18f2a9c4b1e7'), false)
  assert.equal(isLocalThread(null), false)
})

test('only mail gets the "Email —" heading', () => {
  // Measured, not stylistic: prefixing every source produced "Texts — Texts
  // with …" and "Email — Call with Eric Tuaone". A local subject is already
  // self-describing because the ingestion wrote it.
  assert.equal(threadUpdateHeading('email', 'Re: Steelton PSA'), 'Email — Re: Steelton PSA')
  assert.equal(threadUpdateHeading('imessage', 'Texts with Eric — 10-11'), 'Texts with Eric — 10-11')
  assert.equal(threadUpdateHeading('call', 'Call with Eric Tuaone'), 'Call with Eric Tuaone')
  assert.equal(threadUpdateHeading('recording', 'Steelton site walk'), 'Steelton site walk')
})

test('an empty subject falls back to a label rather than rendering blank', () => {
  // A bare em dash or an empty heading reads as a failed render (§12 UI).
  assert.equal(threadUpdateHeading('recording', '   '), 'Recorded meeting')
  assert.equal(threadUpdateHeading('email', null), 'Email — Email thread')
  for (const source of ['email', 'imessage', 'note', 'call', 'recording'] as const) {
    assert.ok(threadSourceLabel(source).length > 0)
  }
})
