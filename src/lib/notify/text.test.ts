/**
 * The two places a mistake is expensive: who gets texted, and whether the
 * platform can recognise its own output.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bodyHash, gatewayAddress, normalizeBody, normalizeHandle, parseTextTargets } from './text'

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
