/**
 * A recorded call's title must never become a filing key.
 *
 * Kept beside the Notes code rather than with the identifier module, because
 * this is the guard that makes it safe for `call-record.ts` to store iOS's own
 * title as `source_title` — and a future reader deleting the guard should find
 * the reason where the caller lives.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeMeetingTitle } from '@/lib/email-sweep/identifiers'

test('a title naming a PERSON is not learnable', () => {
  // Without this, confirming the first recorded call onto a project teaches
  // "call with eric tuaone" as that project's filing key — and every later call
  // with a colleague, about anything, files itself onto that one deal.
  assert.equal(normalizeMeetingTitle('Call with Eric Tuaone'), null)
  assert.equal(normalizeMeetingTitle('call with Merlin Corbin'), null)
  assert.equal(normalizeMeetingTitle('Call w/ Rebecca'), null)
})

test('a deal title that merely mentions a call still is', () => {
  // Anchored at the start, so the words are only disqualifying as the FORM of
  // the title rather than anywhere inside it.
  assert.ok(normalizeMeetingTitle('Steelton — call with the lender'))
  assert.ok(normalizeMeetingTitle('Ber Wilson/Tensor Discuss Uintah Basin'))
})

test('a title made only of calendar vocabulary is still refused', () => {
  assert.equal(normalizeMeetingTitle('Weekly Project Review Meeting'), null)
  assert.equal(normalizeMeetingTitle('Catch up'), null)
})
