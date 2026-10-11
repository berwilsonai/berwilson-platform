import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distinctiveTerms } from './egress'

/**
 * The egress guard's matching rules.
 *
 * These are the two §12 lessons that already cost hours, so they are asserted
 * rather than trusted: a shared industry word must never identify a record, and
 * a PLACE name must always be allowed to.
 */

test('industry words and legal suffixes are never distinctive', () => {
  // "Delta Energy Partners LLC" must not be identifiable by "energy".
  const terms = distinctiveTerms('Delta Energy Partners LLC')
  assert.ok(!terms.includes('energy'), 'energy is a shared industry word')
  assert.ok(!terms.includes('partners'), 'partners is corporate filler')
  assert.ok(!terms.includes('llc'), 'llc is a legal suffix')
})

test('place names ARE distinctive — they are what tells these records apart', () => {
  // Myton, Delta, Heber, Steelton and Stockton are the live examples.
  for (const place of ['Myton', 'Steelton', 'Stockton', 'Heber']) {
    const terms = distinctiveTerms(`${place} Industrial Campus`)
    assert.ok(
      terms.includes(place.toLowerCase()),
      `${place} must stay matchable — it is the distinguishing word`
    )
  }
})

test('a name made only of generic words yields no terms, not a wildcard', () => {
  // The dangerous failure: a project called "The Development Company" must not
  // produce a term that matches half the corpus. No terms is the right answer —
  // the caller still matches the full phrase separately.
  assert.deepEqual(distinctiveTerms('The Development Company LLC'), [])
})

test('short tokens are dropped', () => {
  // Two- and three-letter fragments match inside too many real words.
  const terms = distinctiveTerms('JV Co of UT')
  assert.deepEqual(terms, [])
})

test('punctuation and casing do not change the terms', () => {
  assert.deepEqual(distinctiveTerms("Steelton/Riverdale (Phase 2)"), ['steelton', 'riverdale'])
})

test('digits survive — a solicitation-style name is identifying', () => {
  assert.ok(distinctiveTerms('Zenthium W912 Partnership').includes('w912'))
})
