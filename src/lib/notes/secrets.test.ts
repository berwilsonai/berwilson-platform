/**
 * The credential guard, against the strings that actually appear in this
 * corpus — the real keys it must refuse, and the real work notes it must not.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { judgeSecrets } from './secrets'

test('refuses the notes that really hold credentials', () => {
  // All taken from the live corpus (values altered, shapes kept).
  const cases: [string, string][] = [
    ['Ber Wilson Passcodes', 'Brighton bank 2484# Front door glass code 1357'],
    ['Macu banking info', 'Customer # 320271915 routing number 124302150'],
    ['ANTHROPIC_KEY', 'ANTHROPIC_KEY = "sk-ant-api03-rz6AGuCnIkQ1xZb2mT"'],
    ['Clawdia AWS', 'api key AKIA7PQ2MX4ZLD9VBN3K'],
    ['N8n lead', 'client id 453444037673-viggvnar8h2k1q.apps.googleusercontent.com'],
    ['GoDaddy', 'PW: gosqYs-fyjzeg-dyfpi2'],
    ['SSH terminal', 'login: deploy  access token ghp_9fK2mQ7xVb1LpZr4Ts'],
  ]
  for (const [title, body] of cases) {
    const v = judgeSecrets(title, body)
    assert.equal(v.refuse, true, `should refuse ${JSON.stringify(title)}`)
  }
})

test('the reason names the RULE and never quotes the secret', () => {
  // ⚠ A log line saying `refused: matched "PW- WilsonMoose@$1"` would copy the
  // secret into a log file that is not protected the way the note is.
  const v = judgeSecrets('GoDaddy', 'PW: gosqYs-fyjzeg-dyfpi2')
  assert.ok(v.reason)
  assert.doesNotMatch(v.reason!, /gosqYs|fyjzeg|dyfpi2/)
})

test('does NOT refuse a work note whose only long string is a link', () => {
  // ⚠ MEASURED: the first version refused `BW Task list Eric` and `Tasks`,
  // two of the most work-relevant notes on the box, for a Drive URL and for
  // `website/host/deliver/what` — ordinary words joined by slashes. A work
  // folder is full of links, so this is the case that matters most.
  const linky = judgeSecrets(
    'BW Task list Eric',
    'Steelton PSA — see https://docs.google.com/document/d/1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUvWxYz/edit'
  )
  assert.equal(linky.refuse, false, linky.reason ?? '')

  const slashes = judgeSecrets('Tasks', 'website/host/deliver/what and projects/infographics')
  assert.equal(slashes.refuse, false, slashes.reason ?? '')
})

test('does not refuse ordinary deal prose', () => {
  const v = judgeSecrets(
    'Alaska Offer',
    'Taylor at Englert Mining wants 665 acres at Golden Summit. Closing 1 Nov, Fairbanks.'
  )
  assert.equal(v.refuse, false, v.reason ?? '')
})

test('a long hyphenated phrase with no digits is not a key', () => {
  const v = judgeSecrets('Notes', 'cross-functional-stakeholder-alignment-review')
  assert.equal(v.refuse, false, v.reason ?? '')
})
