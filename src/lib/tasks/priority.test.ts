import test from 'node:test'
import assert from 'node:assert/strict'
import { taskTier, tierRank, EMPTY_LIVE_CONTEXT, type LiveContext } from './priority'

const LIVE_PROJECT = '11111111-1111-1111-1111-111111111111'
const QUIET_PROJECT = '22222222-2222-2222-2222-222222222222'
const LIVE_COMMITMENT = '33333333-3333-3333-3333-333333333333'

const live: LiveContext = {
  liveRecordIds: new Set([LIVE_PROJECT]),
  liveCommitmentIds: new Set([LIVE_COMMITMENT]),
}

test('a task on a deal with recent correspondence is live', () => {
  assert.equal(taskTier({ project_id: LIVE_PROJECT }, live), 'live')
})

test('a task on a deal that has gone quiet is attached, not live', () => {
  assert.equal(taskTier({ project_id: QUIET_PROJECT }, live), 'tagged')
})

test('an opportunity counts the same as a project', () => {
  assert.equal(taskTier({ opportunity_id: LIVE_PROJECT }, live), 'live')
})

/**
 * The route most promoted obligations take. 277 of 367 open commitments name
 * neither a project nor an opportunity, so a tag-only test would file every
 * item off Eric's rundown as unattached — the opposite of the truth.
 */
test('a task promoted from a live conversation is live with no record at all', () => {
  assert.equal(
    taskTier({ project_id: null, commitment_id: LIVE_COMMITMENT }, live),
    'live'
  )
})

test('a promoted task whose conversation went quiet is attached', () => {
  assert.equal(taskTier({ commitment_id: 'unknown-id' }, live), 'tagged')
})

test('an objective is enough to be attached — the steering board is a statement', () => {
  assert.equal(taskTier({ objective_id: 'obj' }, live), 'tagged')
})

test('a task on nothing is unattached', () => {
  assert.equal(taskTier({}, live), 'unattached')
})

/**
 * The board and the sheet both fall back to this when the ranking read fails.
 * It must demote everything equally rather than, say, calling tagged work live.
 */
test('an empty context ranks every tier by its tags alone', () => {
  assert.equal(taskTier({ project_id: LIVE_PROJECT }, EMPTY_LIVE_CONTEXT), 'tagged')
  assert.equal(taskTier({}, EMPTY_LIVE_CONTEXT), 'unattached')
})

test('live sorts before attached, which sorts before unattached', () => {
  assert.ok(tierRank('live') < tierRank('tagged'))
  assert.ok(tierRank('tagged') < tierRank('unattached'))
})
