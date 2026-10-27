import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  laneStep,
  indexStep,
  isNoOpMove,
  commitMove,
  applyMove,
  announceGrab,
  announceGrabLaneOnly,
  announceMove,
  announceMoveLaneOnly,
  announceDrop,
  announceCancel,
  type Lane,
  type DragState,
} from './dnd'

const LANES: Lane[] = [
  { id: 'capture', label: 'Capture' },
  { id: 'bidding', label: 'Bidding' },
  { id: 'negotiating', label: 'Negotiating' },
]

interface Card { id: string; stage: string }
const setStage = (c: Card, stage: string): Card => ({ ...c, stage })
const stageOf = (c: Card) => c.stage

function board(): Card[] {
  return [
    { id: 'a', stage: 'capture' },
    { id: 'b', stage: 'capture' },
    { id: 'c', stage: 'capture' },
    { id: 'd', stage: 'bidding' },
  ]
}

function drag(over: Partial<DragState> = {}): DragState {
  return { itemId: 'a', fromLaneId: 'capture', fromIndex: 0, laneId: 'capture', index: 0, ...over }
}

// ─── stepping ────────────────────────────────────────────────────────────────

test('a lane step CLAMPS at both ends rather than wrapping', () => {
  assert.equal(laneStep(LANES, 'capture', 1), 'bidding')
  assert.equal(laneStep(LANES, 'bidding', -1), 'capture')
  // A pipeline is ordered, so wrapping would turn the last stage into the
  // first on one keypress — a data change nobody asked for.
  assert.equal(laneStep(LANES, 'capture', -1), 'capture')
  assert.equal(laneStep(LANES, 'negotiating', 1), 'negotiating')
})

test('a lane step on an unknown lane is a no-op, never a throw', () => {
  // A lane can disappear under a drag: the stage filter in the URL restricts
  // which columns render (ProjectsClient), so a re-render mid-drag can leave
  // the held lane absent. Returning the current id keeps the drag alive.
  assert.equal(laneStep(LANES, 'archived', 1), 'archived')
})

test('an index step clamps to the lane it is landing in', () => {
  assert.equal(indexStep(3, 0, 1), 1)
  assert.equal(indexStep(3, 2, 1), 2)
  assert.equal(indexStep(3, 0, -1), 0)
  // An empty destination lane has one valid position: the first.
  assert.equal(indexStep(0, 0, 1), 0)
  assert.equal(indexStep(1, 0, 1), 0)
})

// ─── the no-op guard ─────────────────────────────────────────────────────────

test('a drop that lands where it started commits NOTHING', () => {
  assert.equal(isNoOpMove(drag()), true)
  assert.equal(commitMove(drag()), null)
  // The optimistic update would be a no-op, but the router.refresh() behind it
  // is a real round-trip and the toast would claim a stage change that never
  // happened.
  assert.equal(commitMove(drag({ laneId: 'bidding' }))?.toLaneId, 'bidding')
  assert.equal(commitMove(drag({ index: 2 }))?.toIndex, 2)
})

test('a cross-lane move reports both ends, so it can be undone by hand', () => {
  const m = commitMove(drag({ itemId: 'c', fromLaneId: 'capture', fromIndex: 2, laneId: 'negotiating', index: 0 }))
  assert.deepEqual(m, {
    itemId: 'c',
    fromLaneId: 'capture',
    toLaneId: 'negotiating',
    fromIndex: 2,
    toIndex: 0,
  })
})

// ─── applyMove ───────────────────────────────────────────────────────────────

test('a cross-lane move relocates the item and sets its lane', () => {
  const out = applyMove(board(), commitMove(drag({ itemId: 'a', laneId: 'bidding', index: 0 }))!, setStage, stageOf)
  assert.equal(out.find((c) => c.id === 'a')!.stage, 'bidding')
  assert.equal(out.filter((c) => c.stage === 'capture').map((c) => c.id).join(','), 'b,c')
  assert.equal(out.filter((c) => c.stage === 'bidding').map((c) => c.id).join(','), 'a,d')
})

test('applyMove never mutates the array it was given', () => {
  const before = board()
  const snapshot = before.map((c) => `${c.id}:${c.stage}`).join('|')
  applyMove(before, commitMove(drag({ itemId: 'a', laneId: 'bidding', index: 0 }))!, setStage, stageOf)
  assert.equal(before.map((c) => `${c.id}:${c.stage}`).join('|'), snapshot)
})

/**
 * ⚠ THE CASE THAT PULLS THE TWO READINGS APART.
 *
 * Moving `a` (index 0) DOWN to index 1 within its own lane is the only shape
 * where "insert at the target index" and "insert at the target index after
 * removing" give different answers — removing `a` first shifts `b` and `c`
 * down one, so a raw insert at 1 lands `a` back at the top and the move reads
 * as ignored. Every cross-lane case and every upward case agree, which is
 * exactly why a test built on one of those would pass against both readings
 * (§12: a worked example whose figures coincide cannot distinguish two
 * readings of the rule it illustrates).
 */
test('a same-lane DOWNWARD reorder actually moves the item', () => {
  const out = applyMove(board(), commitMove(drag({ itemId: 'a', laneId: 'capture', index: 1 }))!, setStage, stageOf)
  assert.equal(
    out.filter((c) => c.stage === 'capture').map((c) => c.id).join(','),
    'b,a,c',
    'a should sit between b and c, not back at the top'
  )
})

test('a same-lane upward reorder agrees with it', () => {
  const out = applyMove(board(), commitMove(drag({ itemId: 'c', fromIndex: 2, laneId: 'capture', index: 0 }))!, setStage, stageOf)
  assert.equal(out.filter((c) => c.stage === 'capture').map((c) => c.id).join(','), 'c,a,b')
})

test('dropping into an EMPTY lane places the item there, not at the top of the board', () => {
  const out = applyMove(board(), commitMove(drag({ itemId: 'a', laneId: 'negotiating', index: 0 }))!, setStage, stageOf)
  assert.equal(out.find((c) => c.id === 'a')!.stage, 'negotiating')
  // The board order must still read capture → bidding → negotiating, so the
  // relocated card lands last rather than jumping to index 0 of everything.
  assert.equal(out.map((c) => c.id).join(','), 'b,c,d,a')
})

test('dropping PAST the end of a lane lands after its last item', () => {
  const out = applyMove(board(), commitMove(drag({ itemId: 'a', laneId: 'bidding', index: 9 }))!, setStage, stageOf)
  assert.equal(out.filter((c) => c.stage === 'bidding').map((c) => c.id).join(','), 'd,a')
})

test('a move naming an item that is not on the board returns the board unchanged', () => {
  // A board re-renders under a drag (a sweep lands, a filter changes), so the
  // held id can genuinely be gone by the time the drop fires. That must be a
  // quiet no-op, not a crash in an event handler.
  const out = applyMove(board(), { itemId: 'zz', fromLaneId: 'capture', toLaneId: 'bidding', fromIndex: 0, toIndex: 0 }, setStage, stageOf)
  assert.equal(out.map((c) => c.id).join(','), 'a,b,c,d')
})

// ─── announcements ───────────────────────────────────────────────────────────

test('announcements are one-based, because that is what a person hears', () => {
  // Zero-based in the state, one-based in the speech. Mixing them is how an
  // announcement says "position 0".
  assert.match(announceGrab('Steelton', 'Bidding', 0, 3), /position 1 of 3/)
  assert.match(announceMove('Steelton', 'Bidding', 2, 3), /position 3 of 3/)
})

test('a grab announcement states the controls, since nothing else can', () => {
  const said = announceGrab('Steelton', 'Bidding', 0, 3)
  assert.match(said, /Steelton/)
  assert.match(said, /picked up from Bidding/)
  assert.match(said, /arrow keys/)
  assert.match(said, /space to drop/)
  assert.match(said, /escape to cancel/)
})

test('a drop names the lane it LEFT, and a reorder is worded apart from a move', () => {
  assert.equal(announceDrop('Steelton', 'Capture', 'Bidding'), 'Steelton moved from Capture to Bidding.')
  // Same lane in and out is a reorder, and saying "moved from Bidding to
  // Bidding" reads as a failed action.
  assert.equal(announceDrop('Steelton', 'Bidding', 'Bidding'), 'Steelton reordered within Bidding.')
})

test('a cancel says plainly that nothing changed', () => {
  assert.match(announceCancel('Steelton', 'Capture'), /Nothing changed/)
})

test('no announcement can render undefined or NaN into the live region', () => {
  // §12: assert no NaN/undefined/Infinity reaches the markup. A live region is
  // markup a reader cannot see, so a bad interpolation there is invisible.
  const all = [
    announceGrab('X', 'L', 0, 1),
    announceMove('X', 'L', 0, 1),
    announceDrop('X', 'A', 'B'),
    announceCancel('X', 'L'),
  ]
  for (const s of all) {
    assert.doesNotMatch(s, /undefined|NaN|Infinity|\[object/, s)
  }
})

test('a lane-only board does NOT announce a position it cannot save', () => {
  // `projects` and `tasks` carry no order column (measured 2026-10-26), so
  // "position 1 of 4" would promise a reorder that the next server render
  // discards. The vertical arrows are refused on those boards, and the speech
  // has to agree with the keys — a hint naming a key that does nothing is the
  // same defect as the lie it replaced.
  const said = announceGrabLaneOnly('Steelton', 'Bidding')
  assert.doesNotMatch(said, /position/)
  assert.match(said, /left and right arrow keys/)
  assert.match(said, /space to drop/)
  assert.match(said, /escape to cancel/)

  assert.equal(announceMoveLaneOnly('Steelton', 'Negotiating'), 'Steelton, Negotiating.')
  assert.doesNotMatch(announceMoveLaneOnly('Steelton', 'Negotiating'), /position|undefined|NaN/)
})

test('the reorderable and lane-only grabs differ in exactly the position claim', () => {
  // Pulls the two readings apart rather than asserting each in isolation: the
  // reorderable one must make the claim, the other must not.
  assert.match(announceGrab('X', 'L', 0, 4), /position 1 of 4/)
  assert.doesNotMatch(announceGrabLaneOnly('X', 'L'), /position/)
})
