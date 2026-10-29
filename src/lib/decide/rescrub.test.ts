/**
 * Re-checking where a staged conversation belongs.
 *
 * ⚠ THESE EXIST BECAUSE THE PASS HANDS A MODEL A LIST AND READS ITS REPLY AS AN
 * ID. That is only safe while the reply is checked back against the list, whole
 * — and "whole" is doing real work here: the register holds both
 * *Alaska Strategic Materials JV* and *Alaska Golden Summit / True North Gold &
 * Geologic Hydrogen JV*, two live records whose documents are already split
 * across each other (§13). A resolver that accepted a prefix would merge the
 * two on the model's first abbreviation.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRegister, resolveRescrubAnswer } from './rescrub'

const TARGETS = [
  { kind: 'project', id: 'p-1', name: 'Steelton — Cleveland-Cliffs (PA)' },
  { kind: 'project', id: 'p-2', name: 'Alaska Strategic Materials JV' },
  { kind: 'opportunity', id: 'o-1', name: 'GridEdge' },
  { kind: 'opportunity', id: 'o-2', name: 'Gold mine' },
  // Not a filing destination on this path — the merge route's tables name only
  // projects and opportunities, so offering one would be a name the write
  // cannot take.
  { kind: 'lead', id: 'l-1', name: 'Some inbound bid' },
]

test('buildRegister keeps projects and opportunities, and nothing else', () => {
  const register = buildRegister(TARGETS)
  assert.deepEqual(
    register.map((e) => e.id).sort(),
    ['o-1', 'o-2', 'p-1', 'p-2']
  )
})

test('buildRegister drops a nameless row rather than registering an empty key', () => {
  const register = buildRegister([...TARGETS, { kind: 'project', id: 'p-9', name: '   ' }])
  assert.equal(register.some((e) => e.id === 'p-9'), false)
})

test('a name two records answer to is dropped from BOTH', () => {
  // §12: an alias claimed by two records makes both unmatchable, not
  // mis-matched. The model replies with a NAME, so a duplicate name cannot be
  // resolved to an id — and resolving it to the first hit is a coin flip over
  // which deal a conversation is filed onto.
  const register = buildRegister([
    ...TARGETS,
    { kind: 'opportunity', id: 'o-9', name: 'gridedge' },
  ])
  assert.equal(register.some((e) => e.name.toLowerCase() === 'gridedge'), false)
  // The others survive — one collision must not empty the register.
  assert.equal(register.some((e) => e.id === 'p-1'), true)
})

const REGISTER = buildRegister(TARGETS)

test('an exact name resolves, whatever its case and spacing', () => {
  const hit = resolveRescrubAnswer(REGISTER, { record: '  gridEDGE ', confidence: 0.9 })
  assert.equal(hit?.id, 'o-1')
  assert.equal(hit?.kind, 'opportunity')
})

test('an invented name does NOT resolve', () => {
  assert.equal(resolveRescrubAnswer(REGISTER, { record: 'GridEdge DC', confidence: 0.99 }), null)
  assert.equal(resolveRescrubAnswer(REGISTER, { record: 'Weirton', confidence: 0.99 }), null)
})

test('a PREFIX of a real name does not resolve — the Alaska pair is why', () => {
  assert.equal(resolveRescrubAnswer(REGISTER, { record: 'Alaska', confidence: 0.95 }), null)
  assert.equal(
    resolveRescrubAnswer(REGISTER, { record: 'Alaska Strategic Materials', confidence: 0.95 }),
    null
  )
  // The whole name still works, so the strictness is not simply refusing.
  assert.equal(
    resolveRescrubAnswer(REGISTER, { record: 'Alaska Strategic Materials JV', confidence: 0.95 })?.id,
    'p-2'
  )
})

test('null, missing and non-string replies all refuse', () => {
  assert.equal(resolveRescrubAnswer(REGISTER, { record: null, confidence: 0.9 }), null)
  assert.equal(resolveRescrubAnswer(REGISTER, { confidence: 0.9 }), null)
  assert.equal(resolveRescrubAnswer(REGISTER, { record: 42, confidence: 0.9 }), null)
  assert.equal(resolveRescrubAnswer(REGISTER, null), null)
})

test('a confidence below the bar refuses, and a missing one is not treated as sure', () => {
  assert.equal(resolveRescrubAnswer(REGISTER, { record: 'GridEdge', confidence: 0.4 }), null)
  assert.equal(resolveRescrubAnswer(REGISTER, { record: 'GridEdge' }), null)
  assert.equal(resolveRescrubAnswer(REGISTER, { record: 'GridEdge', confidence: 'high' }), null)
  assert.equal(resolveRescrubAnswer(REGISTER, { record: 'GridEdge', confidence: 0.6 })?.id, 'o-1')
})

test('the type tag the prompt shows is stripped, in either position', () => {
  // The first live run, exactly: shown "[opportunity] GridEdge", the model
  // answered "GridEdge (opportunity)" at 0.95 and the right match was lost.
  assert.equal(
    resolveRescrubAnswer(REGISTER, { record: 'GridEdge (opportunity)', confidence: 0.95 })?.id,
    'o-1'
  )
  assert.equal(
    resolveRescrubAnswer(REGISTER, { record: '[opportunity] GridEdge', confidence: 0.95 })?.id,
    'o-1'
  )
  assert.equal(
    resolveRescrubAnswer(REGISTER, { record: '[project] Steelton — Cleveland-Cliffs (PA)', confidence: 0.9 })?.id,
    'p-1'
  )
})

test('stripping the tag does NOT make the match fuzzy', () => {
  // The remainder still has to be a whole key. Anything else is refused as
  // firmly as before — the tolerance undoes one known decoration, it does not
  // open the door.
  assert.equal(resolveRescrubAnswer(REGISTER, { record: 'GridEdge DC (opportunity)', confidence: 0.99 }), null)
  assert.equal(resolveRescrubAnswer(REGISTER, { record: 'Alaska (project)', confidence: 0.99 }), null)
  assert.equal(resolveRescrubAnswer(REGISTER, { record: '(opportunity)', confidence: 0.99 }), null)
})

test('a record whose own name ends in a parenthesis is unharmed', () => {
  // "Whiskey (TX)" must resolve as itself — the untouched reply is tried
  // first, so only the two type words are ever stripped.
  const register = buildRegister([
    ...TARGETS,
    { kind: 'project', id: 'p-tx', name: 'Whiskey (TX)' },
    // And the pathological case: a record literally called "(project)".
    { kind: 'opportunity', id: 'o-lit', name: 'Thing (project)' },
  ])
  assert.equal(resolveRescrubAnswer(register, { record: 'Whiskey (TX)', confidence: 0.9 })?.id, 'p-tx')
  assert.equal(
    resolveRescrubAnswer(register, { record: 'Thing (project)', confidence: 0.9 })?.id,
    'o-lit'
  )
})
