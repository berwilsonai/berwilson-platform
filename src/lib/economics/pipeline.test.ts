/**
 * The pipeline figure must never be an unlabelled number, and a total that
 * mixes definitions must say so.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  descendantsOf,
  leafRecords,
  mixedTotalNote,
  pipelineTotal,
  pipelineValue,
  portfolioTotal,
  rolledPipelineValue,
} from './pipeline'

test('a computed capture figure wins and is labelled as capture', () => {
  const value = pipelineValue({ economics_capture_value: 18_000_000, estimated_value: 150_000_000 })
  assert.equal(value.amount, 18_000_000)
  assert.equal(value.source, 'capture')
  assert.equal(value.definition, 'Ber Wilson capture')
})

test('a hand-entered estimate is used when there is no model, and is labelled as such', () => {
  const value = pipelineValue({ estimated_value: 48_000_000_000 })
  assert.equal(value.amount, 48_000_000_000)
  assert.equal(value.source, 'estimated')
  assert.ok(value.definition.toLowerCase().includes('unmodelled'))
})

test('no figure reads as no figure, never as zero', () => {
  const value = pipelineValue({})
  assert.equal(value.amount, null, 'null, so a tile omits it rather than showing $0')
  assert.equal(value.source, 'none')
  assert.equal(value.definition, 'No value set')
})

test('numeric strings from PostgREST are coerced, not concatenated', () => {
  // `numeric` arrives as a string often enough that this is a real case, and
  // string + number would produce "18000000150000000".
  const value = pipelineValue({ economics_capture_value: '18000000' })
  assert.equal(value.amount, 18_000_000)
})

test('a total made of one kind of figure is consistent and says nothing', () => {
  const total = pipelineTotal([
    { economics_capture_value: 10 },
    { economics_capture_value: 20 },
  ])
  assert.equal(total.amount, 30)
  assert.equal(total.modelled, 2)
  assert.equal(total.consistent, true)
  assert.equal(mixedTotalNote(total), null)
})

test('a total that mixes computed capture with hand estimates announces itself', () => {
  const total = pipelineTotal([
    { economics_capture_value: 18_000_000 },
    { estimated_value: 48_000_000_000 },
    {},
  ])
  assert.equal(total.modelled, 1)
  assert.equal(total.estimated, 1)
  assert.equal(total.unpriced, 1)
  assert.equal(total.consistent, false)
  assert.equal(mixedTotalNote(total), '1 modelled, 1 estimated by hand')
})

test('unpriced records are counted, not silently dropped from the denominator', () => {
  const total = pipelineTotal([{}, {}, { economics_capture_value: 5 }])
  assert.equal(total.amount, 5)
  assert.equal(total.unpriced, 2, 'so a tile can say 1 of 3 deals is priced')
})

// ── hierarchy ───────────────────────────────────────────────────────────────
//
// `parent_project_id` was used by 0 of 14 projects, so none of this arithmetic
// had ever run. These tests exist because three screens were double-counting a
// program against its own sub-projects and nothing said so.

test('a flat set is all leaves, so nothing changes for the normal case', () => {
  const records = [
    { id: 'a', economics_capture_value: 10 },
    { id: 'b', economics_capture_value: 20 },
  ]
  assert.equal(leafRecords(records).length, 2)
  const total = portfolioTotal(records)
  assert.equal(total.amount, 30)
  assert.equal(total.rolledUp, 0)
})

test('a parent is held out of a portfolio total when its children are present', () => {
  const records = [
    { id: 'program', economics_capture_value: 100 },
    { id: 'child-1', parent_project_id: 'program', economics_capture_value: 40 },
    { id: 'child-2', parent_project_id: 'program', economics_capture_value: 35 },
  ]
  const total = portfolioTotal(records)
  assert.equal(total.amount, 75, 'the leaves, not 175')
  assert.equal(total.rolledUp, 1)
  assert.equal(total.modelled, 2)
})

test('a parent whose children are absent from the set keeps its own figure', () => {
  // `dropHidden` (confidential projects) and every search filter produce
  // exactly this set. Judging parenthood by the column alone would make the
  // deal vanish from its own total.
  const total = portfolioTotal([{ id: 'program', parent_project_id: null, economics_capture_value: 100 }])
  assert.equal(total.amount, 100)
  assert.equal(total.rolledUp, 0)
})

test('a child whose parent is absent still counts', () => {
  const total = portfolioTotal([{ id: 'child', parent_project_id: 'gone', economics_capture_value: 40 }])
  assert.equal(total.amount, 40)
})

test('a grandchild displaces both its parent and its grandparent', () => {
  const records = [
    { id: 'program', economics_capture_value: 999 },
    { id: 'phase', parent_project_id: 'program', economics_capture_value: 500 },
    { id: 'building', parent_project_id: 'phase', economics_capture_value: 60 },
  ]
  assert.equal(portfolioTotal(records).amount, 60)
  assert.equal(descendantsOf('program', records).length, 2)
})

test('a cycle in parent_project_id terminates instead of hanging the page', () => {
  // Nothing in the schema prevents one, and an infinite loop in a server
  // component is a hung request rather than an error anybody sees.
  const records = [
    { id: 'a', parent_project_id: 'b', economics_capture_value: 1 },
    { id: 'b', parent_project_id: 'a', economics_capture_value: 2 },
  ]
  assert.equal(descendantsOf('a', records).length, 1)
  assert.doesNotThrow(() => portfolioTotal(records))
})

test("a program's own figure is overruled by its children and reported as overruled", () => {
  const records = [
    { id: 'program', economics_capture_value: 100 },
    { id: 'child', parent_project_id: 'program', economics_capture_value: 40 },
  ]
  const rolled = rolledPipelineValue(records[0], records)
  assert.equal(rolled.amount, 40)
  assert.equal(rolled.rolled, true)
  assert.equal(rolled.leaves, 1)
  assert.equal(rolled.ownValue?.amount, 100, 'the overruled figure is handed back, not dropped')
})

test('a leaf answers for itself and reports nothing as overruled', () => {
  const records = [{ id: 'solo', economics_capture_value: 40 }]
  const rolled = rolledPipelineValue(records[0], records)
  assert.equal(rolled.rolled, false)
  assert.equal(rolled.ownValue, null)
  assert.equal(rolled.definition, 'Ber Wilson capture')
})

test('a program whose sub-projects are all unpriced rolls up to null, never $0', () => {
  const records = [
    { id: 'program', economics_capture_value: 100 },
    { id: 'child', parent_project_id: 'program' },
  ]
  const rolled = rolledPipelineValue(records[0], records)
  assert.equal(rolled.amount, null, '"$0" would be a statement about the deal that nobody made')
  assert.equal(rolled.source, 'none')
})

test('one hand-entered estimate inside a rollup weakens the whole figure', () => {
  const records = [
    { id: 'program' },
    { id: 'c1', parent_project_id: 'program', economics_capture_value: 40 },
    { id: 'c2', parent_project_id: 'program', estimated_value: 60 },
  ]
  const rolled = rolledPipelineValue(records[0], records)
  assert.equal(rolled.amount, 100)
  assert.equal(rolled.source, 'estimated', 'a total holding a guess is no better evidenced than the guess')
  assert.ok(rolled.hint.includes('1 modelled, 1 estimated by hand'))
})
