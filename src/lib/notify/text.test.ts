/**
 * The two places a mistake is expensive: who gets texted, and whether the
 * platform can recognise its own output.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PEPPER_SIGNATURE,
  bodyHash,
  gatewayAddress,
  gatewaySender,
  normalizeBody,
  normalizeHandle,
  parseTextTargets,
  signAsPepper,
} from './text'

test('a 10-digit US number becomes E.164', () => {
  assert.equal(normalizeHandle('8018159150'), '+18018159150')
  assert.equal(normalizeHandle('801-815-9150'), '+18018159150')
  assert.equal(normalizeHandle('(801) 815-9150'), '+18018159150')
  assert.equal(normalizeHandle('1 385 436 6519'), '+13854366519')
  assert.equal(normalizeHandle('+13854366519'), '+13854366519')
})

test('an unusable handle is REFUSED, never guessed', () => {
  // A wrong handle texts a deal's obligations to a stranger. Fail closed.
  for (const bad of ['', '   ', '12345', 'moose@berwilson.com', '801-815', 'abcdefghij']) {
    assert.equal(normalizeHandle(bad), null, `should refuse ${JSON.stringify(bad)}`)
  }
})

test('targets parse from one variable', () => {
  const { targets, problems } = parseTextTargets(
    'moose@berwilson.com=+18018159150=Pepper Text Richard;tuaone@berwilson.com=385-436-6519=Pepper Text Eric'
  )
  assert.equal(problems.length, 0)
  assert.equal(targets.length, 2)
  assert.deepEqual(targets[0], {
    email: 'moose@berwilson.com',
    handle: '+18018159150',
    shortcut: 'Pepper Text Richard',
    // Absent from the entry, so null — the carrier domain then falls back to
    // PEPPER_TEXT_GATEWAY_DOMAIN, never to a guess (see gatewayAddress).
    carrierDomain: null,
  })
  // Normalized on the way in, so the guard and the audit row agree.
  assert.equal(targets[1].handle, '+13854366519')
})

test('a malformed entry drops THAT entry and says so', () => {
  const { targets, problems } = parseTextTargets(
    'moose@berwilson.com=+18018159150=Pepper Text Richard;broken-entry;eric=+1385=S'
  )
  assert.equal(targets.length, 1)
  assert.equal(problems.length, 2)
  assert.match(problems[0], /malformed/)
})

test('an unset or empty variable yields no targets and no error', () => {
  // Nothing sends, nothing throws at 06:50.
  assert.deepEqual(parseTextTargets(undefined), { targets: [], problems: [] })
  assert.deepEqual(parseTextTargets('   '), { targets: [], problems: [] })
})

test('the hash survives the round trip through chat.db', () => {
  // ⚠ THE GUARD DEPENDS ON THIS. A message read back is not byte-identical to
  // what was sent: line endings change and trailing whitespace is trimmed.
  const sent = 'Morning.\r\nSteelton closing moved to 1 Nov.   \r\n\r\nTwo things today.  '
  const readBack = 'Morning.\nSteelton closing moved to 1 Nov.\n\nTwo things today.'
  assert.equal(bodyHash(sent), bodyHash(readBack))
  assert.equal(normalizeBody(sent), readBack)
})

test('different bodies do not collide', () => {
  assert.notEqual(bodyHash('one thing today'), bodyHash('two things today'))
})

// ─── the carrier gateway ─────────────────────────────────────────────────────
//
// Added 2026-10-19, when the measurement was that the Shortcut transport had
// delivered NOTHING in the seven days it had been live — ten consecutive runs
// of `Couldn't find shortcut "Pepper Text Richard"`, because the two shortcuts
// have to be built by hand and never were.

test('a carrier domain on the entry makes a gateway address', () => {
  const { targets, problems } = parseTextTargets(
    'moose@berwilson.com=+18018159150=Pepper Text Richard=tmomail.net'
  )
  assert.deepEqual(problems, [])
  assert.equal(targets[0].carrierDomain, 'tmomail.net')
  // US gateways are addressed by the 10 digits, WITHOUT the country code — the
  // E.164 handle is right for Messages and wrong for the carrier.
  assert.equal(gatewayAddress(targets[0]), '8018159150@tmomail.net')
})

test('the fourth field is optional, so every existing entry still parses', () => {
  const { targets, problems } = parseTextTargets(
    'moose@berwilson.com=+18018159150=Pepper Text Richard;tuaone@berwilson.com=385-436-6519=Pepper Text Eric'
  )
  assert.deepEqual(problems, [])
  assert.equal(targets.length, 2)
  assert.equal(targets[1].handle, '+13854366519')
})

test('no carrier domain means no gateway address — never a guessed one', () => {
  // ⚠ FAIL CLOSED. A wrong domain texts a deal's obligations to whoever owns
  // that number on another carrier, so an unknown carrier yields null and the
  // Shortcut transport is used instead.
  assert.equal(
    gatewayAddress(
      { email: 'a@b.com', handle: '+18018159150', shortcut: 'S', carrierDomain: null },
      { defaultDomain: null }
    ),
    null
  )
  assert.equal(
    gatewayAddress(
      { email: 'a@b.com', handle: '+18018159150', shortcut: 'S' },
      { defaultDomain: 'tmomail.net' }
    ),
    '8018159150@tmomail.net'
  )
  // The per-person field wins over the roster default: one of them changing
  // carrier must not need a redeploy of the other's.
  assert.equal(
    gatewayAddress(
      { email: 'a@b.com', handle: '+18018159150', shortcut: 'S', carrierDomain: 'vtext.com' },
      { defaultDomain: 'tmomail.net' }
    ),
    '8018159150@vtext.com'
  )
})

test('a domain that is not a domain is refused', () => {
  const base = { email: 'a@b.com', handle: '+18018159150', shortcut: 'S' }
  assert.equal(gatewayAddress({ ...base, carrierDomain: 'tmomail' }), null)
  assert.equal(gatewayAddress({ ...base, carrierDomain: '  ' }), null)
  // A leading @ is a plausible way to write it and must not double up.
  assert.equal(gatewayAddress({ ...base, carrierDomain: '@tmomail.net' }), '8018159150@tmomail.net')
})

test('a handle too short to be a US number gets no gateway address', () => {
  assert.equal(
    gatewayAddress({ email: 'a@b.com', handle: '+4477', shortcut: 'S', carrierDomain: 'tmomail.net' }),
    null
  )
})

// ---------------------------------------------------------------------------
// Who a text comes from, and what it is signed as
//
// Richard's instruction, 2026-10-26: a notification texted to him or to Eric
// comes from info@berwilson.com, signed as Pepper. Pinned here because the
// three things that carry it are all defaulted env vars, and an unset variable
// deciding an identity is how one drifts with nobody editing it (§12).
// ---------------------------------------------------------------------------

test('a text is sent AS info@berwilson.com, named Pepper', () => {
  const { from, fromName } = gatewaySender()
  assert.equal(from, 'info@berwilson.com')
  assert.equal(fromName, 'Pepper')
})

test('the subject a carrier renders into the text names Pepper, not the platform', () => {
  // It read 'Ber AI' until 10-26 — the system's name, where the first thing a
  // text should answer is who is speaking.
  assert.equal(gatewaySender().subject, 'Pepper')
})

test('an unsigned body gets signed', () => {
  const body = signAsPepper('Due today, Eric: 1 task still open.')
  assert.ok(body.endsWith(PEPPER_SIGNATURE), body)
  assert.equal(body.split('\n').filter((l) => l.trim() === PEPPER_SIGNATURE).length, 1)
})

test('a body that already signs itself is NOT signed twice', () => {
  // `record_alert` composes its own signature and puts the record's link BELOW
  // it deliberately — "where a single tap lands". A blind append would both
  // double the signature and move it to the bottom, so this is the assertion
  // that keeps that shape.
  const composed = ['New project: Tooele', 'Next: send the MNDA', '', PEPPER_SIGNATURE, 'https://example.test/p/1'].join('\n')
  const out = signAsPepper(composed)
  assert.equal(out, composed)
  assert.equal(out.split('\n').filter((l) => l.trim() === PEPPER_SIGNATURE).length, 1)
  // The link stays last, under the signature, exactly as composed.
  assert.ok(out.endsWith('https://example.test/p/1'))
})

test('prose that merely mentions her is still signed', () => {
  // ⚠ WHOLE-LINE MATCH, NEVER CONTAINMENT (§12). "— Pepper" inside a sentence
  // is not a signature, and reading it as one would ship an unsigned text.
  const out = signAsPepper('Pepper could not reach LM Studio — Pepper will retry at 07:00.')
  assert.ok(out.endsWith(`\n\n${PEPPER_SIGNATURE}`), out)
})

test('an empty body stays empty, so the send still refuses it', () => {
  // sendText() returns 'empty body' on a falsy value; signing must not turn
  // nothing into a message that is only a signature.
  assert.equal(signAsPepper(''), '')
  assert.equal(signAsPepper('   \n  '), '')
})

test('the signature is inside the hash the self-loop guard stores', () => {
  // ⚠ sendText hashes the SIGNED body, because ingestion compares what it finds
  // in chat.db against the ledger. Hashing the unsigned body would put a
  // message on the wire that the guard cannot recognise — the 10-09 self-loop
  // rebuilt by a signature.
  const raw = 'Week ahead, Richard. 1 of yours due this week.'
  assert.notEqual(bodyHash(signAsPepper(raw)), bodyHash(raw))
  // And it survives the chat.db round trip the same way an unsigned body does.
  const signed = signAsPepper(raw)
  assert.equal(bodyHash(signed.replace(/\n/g, '\r\n') + '  '), bodyHash(signed))
})
