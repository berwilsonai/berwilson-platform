/**
 * The decision this file guards: EMAIL must arrive, TEXT is best-effort.
 *
 * Richard, 2026-10-26, after T-Mobile was found rejecting the carrier gateway:
 * *"Make email the channel that must arrive."* The expensive mistake would be
 * folding a blocked text into the pass's verdict — a morning that WAS delivered
 * would read `failed`, and the re-run would send it twice.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { textToEmailHtml } from './pair'
import { PEPPER_SIGNATURE, signAsPepper } from './text'

test('a bare URL in a text body becomes a real link in the email', () => {
  // ⚠ THE ONE THING THAT MUST CHANGE BETWEEN THE TWO ENVELOPES. These bodies
  // are composed as texts, where a reader taps a bare URL; a mail reader
  // cannot, so the channel that must arrive would carry an unusable link.
  const html = textToEmailHtml('Due today, Eric: 1 task still open.\nhttps://host.test/tasks')
  assert.ok(html.includes('<a href="https://host.test/tasks">https://host.test/tasks</a>'), html)
})

test('trailing punctuation stays outside the href', () => {
  // A sentence that ends in a URL is common in these bodies, and a trailing
  // '.' inside the href is a link to nowhere.
  const html = textToEmailHtml('Open https://host.test/tasks.')
  assert.ok(html.includes('<a href="https://host.test/tasks">'), html)
  assert.ok(!html.includes('tasks.">'), html)
})

test('line breaks survive, because these bodies are lists of facts', () => {
  const html = textToEmailHtml('one\ntwo\nthree')
  assert.equal(html.match(/<br>/g)?.length, 2)
})

test('a body is escaped before it is linkified', () => {
  // The composers interpolate record names, which are whatever a human typed.
  const html = textToEmailHtml('New project: <script>alert(1)</script>')
  assert.ok(!html.includes('<script>'), html)
  assert.ok(html.includes('&lt;script&gt;'), html)
})

test('the email carries the same signature the text does', () => {
  // One message, two envelopes, one voice — the email is rendered from the
  // SIGNED body, so a reader cannot get an unsigned one on the channel that
  // must arrive.
  const html = textToEmailHtml(signAsPepper('Week ahead, Richard.'))
  assert.ok(html.includes(PEPPER_SIGNATURE), html)
})

test('signing stays idempotent through the email path', () => {
  // The record alert signs itself and puts its link BELOW the signature; the
  // email must not show a second one.
  const body = ['New project: Tooele', '', PEPPER_SIGNATURE, 'https://host.test/p/1'].join('\n')
  const html = textToEmailHtml(signAsPepper(body))
  assert.equal(html.split(PEPPER_SIGNATURE).length - 1, 1, html)
})
