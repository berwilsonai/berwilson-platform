/**
 * The quoted-reply stripper.
 *
 * ⚠ WHY THIS IS THE PIECE WORTH TESTING. It stands between what a human typed
 * on a phone and what the agent is asked. Get it wrong in one direction and
 * Pepper is handed her own 300-word note as the question — which is both a
 * waste of a single-threaded model's prefill and the exact shape that put 131
 * of her own note lines into the commitment ledger on 10-09. Get it wrong in
 * the other and the question itself is truncated away.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripQuotedReply } from './inbound'

test('a Gmail reply keeps the typed words and drops the quote', () => {
  const body = [
    'when does Steelton close?',
    '',
    'On Wed, Oct 15, 2026 at 6:53 AM Pepper <info@berwilson.com> wrote:',
    '> Good morning, Richard',
    '> ## First thing',
    '> - Countersign the GridEdge MNDA',
  ].join('\n')
  assert.equal(stripQuotedReply(body), 'when does Steelton close?')
})

test('an Outlook reply cuts at the divider, not at the From line inside it', () => {
  const body = [
    'what is still open with Tensor?',
    '',
    '________________________________',
    'From: Pepper <info@berwilson.com>',
    'Sent: Wednesday, October 15, 2026 6:53 AM',
  ].join('\n')
  assert.equal(stripQuotedReply(body), 'what is still open with Tensor?')
})

test('a bare mobile signature is not a question', () => {
  // ⚠ CAUGHT IN THE DRY RUN. This returned "Sent from my iPhone", which the
  // caller would have spent a whole agent turn answering.
  assert.equal(stripQuotedReply('Sent from my iPhone\n\nOn Oct 15, 2026, at 06:53, Pepper wrote:'), '')
  assert.equal(stripQuotedReply('Get Outlook for iOS'), '')
})

test('the signature is stripped but the question above it survives', () => {
  const body = 'who owns the Myton parcels?\n\nSent from my iPhone\n\nOn Oct 15, 2026, Pepper wrote:'
  assert.equal(stripQuotedReply(body), 'who owns the Myton parcels?')
})

test("her own note quoted with no reply above it yields nothing", () => {
  // The greeting is a cut marker precisely so a reply-all with nothing typed
  // cannot hand the agent the note it is replying to.
  assert.equal(stripQuotedReply('Good morning, Richard\n\n## First thing\n- Chase Dana'), '')
})

test('a multi-line question is kept whole', () => {
  const body = [
    'two things:',
    '1. when does Steelton close',
    '2. who is on the Tensor call',
    '',
    'On Wed, Oct 15, 2026 at 6:53 AM Pepper wrote:',
    '> Good morning',
  ].join('\n')
  assert.equal(
    stripQuotedReply(body),
    'two things:\n1. when does Steelton close\n2. who is on the Tensor call'
  )
})

test('a reply with no quote at all is returned unchanged', () => {
  assert.equal(stripQuotedReply('what changed on Weirton?'), 'what changed on Weirton?')
})
