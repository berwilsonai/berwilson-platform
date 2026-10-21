/**
 * The alias bar in `resolveRecordByName`.
 *
 * ⚠ WHY THIS BAR EXISTS AT ALL. §12's remedy for a record a matcher cannot
 * reach is *do not weaken the bar; assert an alias* — and until 2026-10-21 this
 * ladder could not read `match_aliases`. Twenty records carried good ones
 * (`Myton Rail` is aliased **Uintah Basin**, Tooele `TEAD`, Steelton
 * `215 S Front St`) and only the THREAD router ever consulted them, so a Meet
 * call titled "Ber Wilson/Tensor Discuss Uintah Basin" resolved to nothing and
 * sat unfiled. One renderer wired to one surface, for the third recorded time.
 *
 * The cases below pull apart the two readings the rule could have had — token
 * containment versus substring — because §12 is explicit that a worked example
 * whose figures coincide cannot distinguish them.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { aliasMatches } from './resolve'

describe('aliasMatches', () => {
  it('matches an alias that IS the whole candidate', () => {
    assert.equal(aliasMatches('Zenthium', 'Zenthium'), true)
    assert.equal(aliasMatches('Uintah Basin', 'uintah basin'), true)
  })

  it('matches a multi-word alias carried inside a longer title', () => {
    // The live case: Myton Rail's asserted alias inside the organiser's own
    // calendar title. This is the whole reason the bar is not equality-only.
    assert.equal(aliasMatches('Uintah Basin', 'Ber Wilson/Tensor Discuss Uintah Basin'), true)
  })

  it('does not need the alias tokens to be adjacent', () => {
    // Matches the thread router's rule exactly (`aliasShared === tokens.size`),
    // which is measured over 735 linked threads. A second, stricter rule here
    // would make a thread and a meeting disagree about what a record is called.
    assert.equal(aliasMatches('Cliffs Steelton', 'Steelton — Cleveland-Cliffs (PA)'), true)
  })

  it('⚠ IS WORD-BOUNDARY SAFE, which a substring test is not', () => {
    // The case that decides between the two readings of the rule. A flattened
    // `.includes()` would return TRUE for all three of these; token comparison
    // returns false, because `dinosaur` is one token and is not `dino`.
    assert.equal(aliasMatches('Dino', 'Dinosaur Ridge'), false)
    assert.equal(aliasMatches('Delta', 'Deltaville Harbor'), false)
    assert.equal(aliasMatches('TEAD', 'Steady State Review'), false)
  })

  it('refuses when only part of a multi-word alias is present', () => {
    // "Uintah" alone is not the assertion a human made. Half an alias is a
    // guess, and this bar FILES rather than suggests.
    assert.equal(aliasMatches('Uintah Basin', 'Uintah County Roads'), false)
    assert.equal(aliasMatches('Daves Farms', 'Daves Garage'), false)
  })

  it('reads punctuation as a separator on both sides', () => {
    // `Dave's Farms` and `Daves Farms` are the same assertion typed twice, and
    // `215 S Front St` arrives with and without the period.
    assert.equal(aliasMatches("Dave's Farms", 'Daves Farms parcel'), true)
    assert.equal(aliasMatches('215 S Front St', '215 S. Front St.'), true)
  })

  it('refuses an alias too thin to act on', () => {
    // A stray one- or two-character entry would match an enormous share of the
    // corpus, and this bar is automatic. Refused here rather than trusted to a
    // caller's length guard.
    assert.equal(aliasMatches('A', 'A Street Project'), false)
    assert.equal(aliasMatches('JV', 'Alaska JV'), false)
    assert.equal(aliasMatches('', 'anything'), false)
  })

  it('is case- and whitespace-insensitive', () => {
    assert.equal(aliasMatches('  gridEDGE  ', 'WES / GridEdge Modular Data Center'), true)
  })
})
