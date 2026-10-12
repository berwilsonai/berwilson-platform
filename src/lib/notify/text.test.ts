/**
 * The two places a mistake is expensive: who gets texted, and whether the
 * platform can recognise its own output.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bodyHash, normalizeBody, normalizeHandle, parseTextTargets } from './text'

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
