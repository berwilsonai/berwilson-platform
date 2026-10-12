import test from 'node:test'
import assert from 'node:assert/strict'
import { isInternalThread } from './internal-tasks'

const internal = new Set([
  'moose@berwilson.com',
  'tuaone@berwilson.com',
  'richmwhite@gmail.com',
  '3854366519@imessage.local',
])

test('a conversation between the two executives is internal', () => {
  assert.equal(isInternalThread(['moose@berwilson.com', 'tuaone@berwilson.com'], internal), true)
})

/** Eric's record holds …5507 and he texts from …6519 — see internalAddresses. */
test("a text session with a colleague's own handle is internal", () => {
  assert.equal(
    isInternalThread(['moose@berwilson.com', '3854366519@imessage.local'], internal),
    true
  )
})

test('one outsider on the thread makes it not internal', () => {
  assert.equal(
    isInternalThread(
      ['moose@berwilson.com', 'tuaone@berwilson.com', 'counsel@lawfirm.com'],
      internal
    ),
    false
  )
})

test('a personal address the platform knows is that person still counts', () => {
  assert.equal(isInternalThread(['richmwhite@gmail.com', 'tuaone@berwilson.com'], internal), true)
})

test('case and surrounding whitespace do not decide it', () => {
  assert.equal(isInternalThread([' Moose@BerWilson.com ', 'tuaone@berwilson.com'], internal), true)
})

/**
 * ⚠ The shape that turns a filter into no filter at all: `[].every(...)` is
 * true, so a thread with no recorded participants would read as internal and
 * have its obligations promoted without anything having been checked.
 */
test('a thread with no recorded participants is NOT internal', () => {
  assert.equal(isInternalThread([], internal), false)
  assert.equal(isInternalThread(null, internal), false)
  assert.equal(isInternalThread(undefined, internal), false)
})

/** The front door is not a person; its mail is usually forwarded counterparty mail. */
test('the assistant seat is not in the internal set, so its threads are excluded', () => {
  assert.equal(isInternalThread(['info@berwilson.com', 'moose@berwilson.com'], internal), false)
})
