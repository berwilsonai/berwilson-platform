/**
 * Who a recorded call was with — the name rule, against the real case and the
 * ones it must refuse.
 *
 * The live case is the whole reason this is not a similarity score: the note
 * says "Eric Tuaone" and the directory holds "Ericson Tua'one".
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { callCounterpartyName, nameMatches } from './call-party'

test('the title gives up the name, and nothing else', () => {
  assert.equal(callCounterpartyName('Call with Eric Tuaone'), 'Eric Tuaone')
  // iOS's own disambiguator for a second call the same day.
  assert.equal(callCounterpartyName('Call with Eric Tuaone (2)'), 'Eric Tuaone')
  assert.equal(callCounterpartyName('  call with   Merlin  Corbin '), 'Merlin Corbin')
  // Not a recorded call at all.
  assert.equal(callCounterpartyName('Steelton closing checklist'), null)
  assert.equal(callCounterpartyName('Call with'), null)
})

test('the real case: a short first name and a punctuated surname', () => {
  const reason = nameMatches('Eric Tuaone', "Ericson Tua'one")
  assert.ok(reason, 'Eric Tuaone must resolve to Ericson Tua\'one')
  assert.match(reason!, /eric → ericson/)
  assert.match(reason!, /tuaone matches/)
})

test('punctuation and case are not a disagreement', () => {
  assert.ok(nameMatches("Tua'one", 'Tuaone'))
  assert.ok(nameMatches('MERLIN CORBIN', 'Merlin Corbin'))
  assert.ok(nameMatches('Mary-Jane Olsen', 'Mary Jane Olsen'))
  // A middle name on the CRM record is extra information, not a conflict.
  assert.ok(nameMatches('Paul Finan', 'Paul J Finan'))
})

test('a first name alone is never a match', () => {
  // ⚠ THE RULE §12 WAS WRITTEN FOR: a lone hit on a weak key is an
  // unchallenged match, not a unique one. With one Chris in the directory,
  // scoring would resolve "Chris" to them confidently.
  assert.equal(nameMatches('Chris', 'Christopher Vance'), null)
  assert.equal(nameMatches('Eric', 'Ericson Tua\'one'), null)
  assert.equal(nameMatches('Dad', 'David Olsen'), null)
})

test('a prefix only shortens a FIRST name, never lengthens a match', () => {
  // "Ericson" is not a way of writing "Eric" — the longer form must be the
  // record's, or any name becomes a prefix of a longer unrelated one.
  assert.equal(nameMatches('Ericson Tuaone', 'Eric Tua'), null)
  // Two characters is an initial, not a shortening.
  assert.equal(nameMatches('Al Tuaone', 'Alexander Tuaone'), null)
})

test('a different person is not a match', () => {
  assert.equal(nameMatches('Eric Tuaone', 'Eric Olsen'), null)
  assert.equal(nameMatches('Merlin Corbin', 'Merlin Energy LLC'), null)
  assert.equal(nameMatches('Rebecca Shaw', 'Rebecca'), null)
})

test('a number instead of a name resolves to nobody', () => {
  assert.equal(callCounterpartyName('Call with +1 (801) 555-0134'), '+1 (801) 555-0134')
  assert.equal(nameMatches('+1 (801) 555-0134', 'Ericson Tua\'one'), null)
})
