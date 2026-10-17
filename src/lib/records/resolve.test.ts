/**
 * The word test that decides which record a name refers to.
 *
 * ⚠ THESE TESTS EXIST BECAUSE A SCORE CANNOT DO THIS JOB, AND THAT WAS MEASURED.
 * The pair in `the wrong match can score higher` below is the whole argument for
 * the design: "Eagle Mountain Development" scored 0.487 against Myton
 * Development (wrong) while "Delta, Utah Campus" scored 0.390 against Delta
 * Industrial Campus (right). No trigram threshold separates those two, because
 * the wrong one shares the word every fourth project here contains. WHICH word
 * matched is the signal — so the stopword list is load-bearing, and a word
 * added to or dropped from it silently changes which deals can be found.
 *
 * `resolveRecordByName` itself reads the database and is exercised by
 * scripts/verify-record-resolver.mts against the live register. What is unit
 * tested here is the pure half, which is where the drift happens.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distinguishingWords, escapeLike } from './resolve'

/** Do these two names share an identity-bearing word? That IS bar 2. */
function shareAWord(a: string, b: string): boolean {
  const theirs = distinguishingWords(b)
  for (const w of distinguishingWords(a)) if (theirs.has(w)) return true
  return false
}

test('a shared industry or structural word is not a match', () => {
  // Four live projects carry "Development"; it is vocabulary, not a name.
  assert.equal(shareAWord('Eagle Mountain Development', 'Myton Development'), false)
  assert.equal(shareAWord('Some Industrial Campus', 'Delta Industrial Campus'), false)
  // "Power" put Stockton Power Nexus forward for a Steelton/Riverdale call.
  assert.equal(
    shareAWord(
      'Steelton & Riverdale Site Reviews & Power Capacity Analysis',
      'Stockton Power Nexus - ER Hospital & Medevac Airport Tower'
    ),
    false
  )
})

test('the wrong match can score higher than the right one, so the word decides', () => {
  // The §12 pair. Trigram: 0.487 for the wrong one, 0.390 for the right one.
  assert.equal(shareAWord('Eagle Mountain Development', 'Myton Development'), false)
  assert.equal(shareAWord('Delta, Utah Campus', 'Delta Industrial Campus'), true)
})

test('a compass direction is a qualifier, not a place', () => {
  // Three "West Virginia" names all resolved to West Wendover on the word west.
  for (const n of ['West Virginia Power Site', 'West Virginia Data Center', 'West Virginia Portfolio']) {
    assert.equal(shareAWord(n, 'West Wendover'), false, n)
  }
  // The record is still reachable by the word that actually identifies it.
  assert.equal(shareAWord('Wendover land parcel', 'West Wendover'), true)
})

test('a place name is exactly what distinguishes these records', () => {
  for (const [a, b] of [
    ['Steelton Letter-PPL', 'Steelton — Cleveland-Cliffs (PA)'],
    ['Myton Industrial Park / PQC DataCenter Development', 'Myton Rail'],
    ['Black Mesa / Tooele Defense Project', 'Tooele'],
    ['Riverdale closing checklist', 'Riverdale — Cleveland-Cliffs (IL)'],
  ] as const) {
    assert.equal(shareAWord(a, b), true, `${a} <-> ${b}`)
  }
})

test('these are the email-intake titles that were proposing new projects', () => {
  // Measured 2026-10-16: each of these sat in the queue as `create` at ~0.93
  // confidence because the trigram matcher scored it <0.30 against the register.
  const live = [
    'Steelton — Cleveland-Cliffs (PA)',
    'DUBHES Helper / Giovanni Resilience Campus',
    'GridEdge',
    'Elite Solutions',
    'Tooele',
    'Whiskey (TX)',
  ]
  const shouldReach: Array<[string, string]> = [
    ['Steelton Data Center Development & Site Evaluation', 'Steelton — Cleveland-Cliffs (PA)'],
    ['Helper Data Center & Community Development', 'DUBHES Helper / Giovanni Resilience Campus'],
    ['WES / GridEdge Modular Data Center Partnership', 'GridEdge'],
    ['Black Mesa / Tooele Defense Project', 'Tooele'],
  ]
  for (const [title, want] of shouldReach) {
    const hits = live.filter((n) => shareAWord(title, n))
    assert.deepEqual(hits, [want], `${title} should reach exactly ${want}, got ${hits.join('|')}`)
  }
})

test('a qualifier is not an identity — bldg and golden, found on the real queue', () => {
  // ⚠ BOTH OF THESE WERE WRONG MATCHES ON THE FIRST RUN over the 106 pending
  // sessions, and both are the compass-direction argument again: the word
  // qualifies a noun rather than naming a deal.
  //
  // 'bldg' — two different buildings on two different bases. `building` was
  // already stopworded; the abbreviation was not, which was the whole bug.
  assert.equal(
    shareAWord(
      'General Stillwell Memorial Army Reserve Center Bldg 1520',
      'DFCM Camp Williams Bldg. 4140 project'
    ),
    false
  )
  // 'golden' — a colour. "Golden Rock" and the DoD "Golden Dome" programme both
  // resolved to Alaska Golden Summit.
  const alaska = 'Alaska Golden Summit / True North Gold & Geologic Hydrogen JV'
  assert.equal(shareAWord('Golden Rock', alaska), false)
  assert.equal(shareAWord('Gaven Industries DTRA / Golden Dome White Paper Pursuit', alaska), false)
  // ⚠ AND NOTHING WAS LOST, which is the half that has to be checked: the real
  // Englert Mining thread still reaches that record on `summit`.
  assert.equal(
    shareAWord('Taylor Englert / Englert Mining Real Estate & Golden Summit Project', alaska),
    true
  )
})

test('a name with nothing but generic words resolves to nothing', () => {
  // "ADU models", "Big client pursuit" — real queue titles that name no deal.
  assert.equal(distinguishingWords('The Project').size, 0)
  assert.equal(distinguishingWords('Site Review Meeting Notes').size, 0)
  // And a two-letter token is never identity ("JV", "Q3").
  assert.equal(distinguishingWords('JV Q3').size, 0)
})

test('escapeLike neutralises the wildcards so ilike stays an exact test', () => {
  assert.equal(escapeLike('100% Design'), '100\\% Design')
  assert.equal(escapeLike('a_b'), 'a\\_b')
  assert.equal(escapeLike('back\\slash'), 'back\\\\slash')
  // A name with no wildcard is untouched — the common case.
  assert.equal(escapeLike('Myton Rail'), 'Myton Rail')
})
