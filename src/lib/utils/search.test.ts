/**
 * The free-text filter behind the Decide queue and the record picker.
 *
 * ⚠ THE CASE THAT MOTIVATED IT IS THE FIRST TEST. Every record name in this
 * portfolio is a compound — "Steelton — Cleveland-Cliffs (PA)",
 * "Delta Industrial Campus — Daves Farms" — and a person types the two words
 * they remember, in the order they remember them. A substring test over the
 * whole phrase answers "nothing" for all of them (§12).
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { searchWords, matchesWords, filterByWords } from './search'

const NAMES = [
  'Steelton — Cleveland-Cliffs (PA)',
  'Riverdale — Cleveland-Cliffs (IL)',
  'GridEdge',
  'Delta Industrial Campus — Daves Farms',
  'Alaska Strategic Materials JV',
]

function names(query: string): string[] {
  return filterByWords(NAMES, query, (n) => n)
}

test('words match in ANY order, not as a phrase', () => {
  assert.deepEqual(names('cleveland steelton'), ['Steelton — Cleveland-Cliffs (PA)'])
  assert.deepEqual(names('steelton cleveland'), ['Steelton — Cleveland-Cliffs (PA)'])
})

test('a partial word matches inside a longer one — "grid edge" finds GridEdge', () => {
  assert.deepEqual(names('grid edge'), ['GridEdge'])
  assert.deepEqual(names('gridedgedc'), [])
})

test('every word must appear — it NARROWS as you type, never widens', () => {
  assert.equal(names('cleveland').length, 2)
  assert.equal(names('cleveland riverdale').length, 1)
  assert.equal(names('cleveland riverdale alaska').length, 0)
})

test('an empty or whitespace query keeps every row', () => {
  assert.equal(names('').length, NAMES.length)
  assert.equal(names('   ').length, NAMES.length)
  assert.deepEqual(searchWords('   '), [])
})

test('case is folded on both sides', () => {
  assert.equal(matchesWords('Steelton — Cleveland-Cliffs (PA)', searchWords('STEELTON')), true)
  assert.equal(matchesWords('steelton', ['Steelton'.toLowerCase()]), true)
})

test('no words means every text matches', () => {
  assert.equal(matchesWords('anything at all', []), true)
})

test('the haystack is the caller’s to choose', () => {
  const rows = [
    { title: 'Untitled package', deal: 'Steelton — Cleveland-Cliffs (PA)' },
    { title: 'Riverdale walk-through', deal: null as string | null },
  ]
  // Searching the title alone cannot find the first row by its deal; searching
  // both can. That difference is the whole reason /decide includes the name on
  // its Accept button in what it searches.
  assert.equal(filterByWords(rows, 'steelton', (r) => r.title).length, 0)
  assert.equal(filterByWords(rows, 'steelton', (r) => `${r.title} ${r.deal ?? ''}`).length, 1)
})
