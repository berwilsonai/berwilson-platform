/**
 * Board drag-and-drop: the pure half.
 *
 * ⚠ IN src/lib, NOT A 'use client' MODULE, and that is deliberate. Server
 * pages render board lanes and client components drive the drag; every export
 * of a `'use client'` file becomes a client reference, which throws at REQUEST
 * time with neither `tsc` nor the build catching it (§12). Everything here is
 * a pure function over plain data so it is testable under
 * `deploy/register.mjs` — which cannot resolve `next/*` at all (§12), so a
 * module importing React would take the whole file down with it.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Measured 2026-10-26: FIVE board surfaces, THREE hand-rolled copies of native
 * HTML5 drag (`SteelPipelineBoard`, `ObjectivesBoard`, `OrgStructureBoard`) and
 * TWO with no drag at all — `/projects`'s pipeline board and `TeamTaskBoard`,
 * which are the two highest-traffic boards in the application. §12 is explicit
 * about this shape: "a shared renderer wired to one surface is worse than no
 * shared renderer — grep for a renderer before building one, and for every
 * surface that should call it after". The three copies are the fork; the two
 * without are the surfaces that should have called it.
 *
 * ⚠ AND ALL THREE COPIES ARE POINTER-ONLY. The steel board says so in its own
 * footer — *"On a phone, open a deal to change its stage"* — so the affordance
 * is absent on the one device Richard actually carries, and absent for a
 * keyboard entirely. A drag that only a mouse can perform is a drag that two
 * of three input methods cannot see, which is the same class of bug as a
 * hover-only control (§12).
 *
 * So the vocabulary below is the KEYBOARD model, and the pointer path is a
 * second caller of the same reducer. That ordering matters: built
 * pointer-first, the keyboard path becomes a bolt-on that has to reconstruct
 * "where am I" from mouse coordinates. Built move-first, a pointer drop and an
 * arrow key are the same call.
 */

/** A lane (column) on a board. `tone` is a name from `tone.ts`, never a class. */
export interface Lane {
  id: string
  label: string
}

/**
 * A keyboard drag in flight: which item, and where it currently sits. This is
 * the whole state — there is no pointer position in it, because a committed
 * move is a (lane, index) pair whatever produced it.
 */
export interface DragState {
  itemId: string
  /** The lane the item started in — needed to report a cancel honestly. */
  fromLaneId: string
  fromIndex: number
  /** Where it is right now, after any number of arrow presses. */
  laneId: string
  index: number
}

/** The committed result of a drag. */
export interface Move {
  itemId: string
  fromLaneId: string
  toLaneId: string
  fromIndex: number
  toIndex: number
}

/**
 * Clamped lane step. Clamps rather than wraps, deliberately: a pipeline is
 * ORDERED — capture → bidding → negotiating — so wrapping from the last stage
 * back to the first would read as "won" becoming "capture" on one keypress,
 * which is a data change nobody asked for. Clamping makes the end of the board
 * feel like the end of the board.
 */
export function laneStep(lanes: readonly Lane[], currentLaneId: string, direction: -1 | 1): string {
  const i = lanes.findIndex((l) => l.id === currentLaneId)
  if (i < 0) return currentLaneId
  const next = i + direction
  if (next < 0 || next >= lanes.length) return currentLaneId
  return lanes[next].id
}

/**
 * Clamped index step within a lane. `count` is the number of items that will
 * be in the destination lane INCLUDING the dragged one, so the last valid
 * index is `count - 1`.
 */
export function indexStep(count: number, currentIndex: number, direction: -1 | 1): number {
  const next = currentIndex + direction
  if (next < 0) return 0
  if (next > count - 1) return Math.max(0, count - 1)
  return next
}

/**
 * Does this drag actually change anything? A drop that lands where it started
 * must NOT fire a mutation — the optimistic update would be a no-op, but the
 * `router.refresh()` behind it is a full server round-trip, and the toast
 * would claim a stage change that did not happen.
 */
export function isNoOpMove(state: DragState): boolean {
  return state.laneId === state.fromLaneId && state.index === state.fromIndex
}

/** The move a drag commits to, or null when it changes nothing. */
export function commitMove(state: DragState): Move | null {
  if (isNoOpMove(state)) return null
  return {
    itemId: state.itemId,
    fromLaneId: state.fromLaneId,
    toLaneId: state.laneId,
    fromIndex: state.fromIndex,
    toIndex: state.index,
  }
}

/**
 * Reorder a flat list of items into a new (lane, index) arrangement.
 *
 * Returns a NEW array — never mutates — because the caller holds it in React
 * state for the optimistic render. Items are keyed by `id` and carry their own
 * lane in whatever field the caller names, so this works for a stage on a
 * project, an assignee on a task and a parent on an org node without knowing
 * which.
 *
 * ⚠ THE REMOVE MUST HAPPEN BEFORE THE INSERT INDEX IS READ. Splicing the item
 * out first shifts every later index down by one, so inserting at the raw
 * target index within the SAME lane lands one position short — the classic
 * off-by-one that makes a reorder feel like it ignores the last step. The test
 * for this pulls the two readings apart on a same-lane downward move, which is
 * the only case where they differ (§12: a worked example whose figures
 * coincide cannot distinguish two readings of the rule).
 */
export function applyMove<T extends { id: string }>(
  items: readonly T[],
  move: Move,
  setLane: (item: T, laneId: string) => T,
  laneOf: (item: T) => string
): T[] {
  const moving = items.find((it) => it.id === move.itemId)
  if (!moving) return [...items]

  const without = items.filter((it) => it.id !== move.itemId)
  const relocated = setLane(moving, move.toLaneId)

  // Index is relative to the destination lane, so find the absolute position
  // of the destination lane's Nth item in the remaining list.
  const destIds = without.filter((it) => laneOf(it) === move.toLaneId)
  const target = destIds[move.toIndex]
  const at = target ? without.indexOf(target) : -1

  const out = [...without]
  if (at < 0) {
    // Dropping past the end of the lane, or into an empty lane: place it after
    // the lane's last item so it does not jump to the top of the board.
    const last = destIds[destIds.length - 1]
    const after = last ? without.indexOf(last) + 1 : without.length
    out.splice(after, 0, relocated)
  } else {
    out.splice(at, 0, relocated)
  }
  return out
}

// ─── Announcements ───────────────────────────────────────────────────────────
/*
 * A keyboard drag is invisible without these. They go into an `aria-live`
 * region, and they are pure string builders so the wording is test-pinned
 * rather than buried in JSX — the thing a screen-reader user hears is as much
 * a part of this feature as the ring around the card.
 *
 * ⚠ ONE-BASED IN THE TEXT, ZERO-BASED IN THE STATE. "Position 1 of 3" is what
 * a person hears; `index: 0` is what the reducer holds. Mixing them is how an
 * announcement says "position 0".
 */

/** Spoken when an item is picked up on a board that can be reordered. */
export function announceGrab(title: string, laneLabel: string, index: number, count: number): string {
  return `${title}, picked up from ${laneLabel}, position ${index + 1} of ${count}. Use the arrow keys to move it, space to drop, escape to cancel.`
}

/**
 * Spoken when an item is picked up on a LANE-ONLY board.
 *
 * ⚠ A BOARD WHOSE TABLE HAS NO ORDER COLUMN CANNOT BE REORDERED, AND SAYING
 * "POSITION 1 OF 4" PROMISES THAT IT CAN. Measured 2026-10-26: `objectives`
 * carries `sort_order`, which is why `ObjectivesBoard` can reorder within a
 * bucket and persist it. `projects` and `tasks` carry NO such column — so a
 * within-lane drag on the pipeline or the task board would animate, optimistic
 * state would hold it, and the next server render would snap it back. That is
 * the shape §12 calls out as an optimistic mutation leaving the screen lying;
 * here the honest fix is for the gesture to refuse rather than for the undo to
 * be invisible. So those boards announce the lanes only, and the vertical
 * arrows do nothing.
 */
export function announceGrabLaneOnly(title: string, laneLabel: string): string {
  return `${title}, picked up from ${laneLabel}. Use the left and right arrow keys to move it, space to drop, escape to cancel.`
}

/** Spoken on every arrow press. */
export function announceMove(title: string, laneLabel: string, index: number, count: number): string {
  return `${title}, ${laneLabel}, position ${index + 1} of ${count}.`
}

/** Spoken on every arrow press on a lane-only board. */
export function announceMoveLaneOnly(title: string, laneLabel: string): string {
  return `${title}, ${laneLabel}.`
}

/** Spoken on a committed drop. Names the lane it LEFT, which is the fact a
 *  reader needs to undo it by hand. */
export function announceDrop(title: string, fromLaneLabel: string, toLaneLabel: string): string {
  if (fromLaneLabel === toLaneLabel) return `${title} reordered within ${toLaneLabel}.`
  return `${title} moved from ${fromLaneLabel} to ${toLaneLabel}.`
}

/** Spoken on escape, or on a drop that changed nothing. */
export function announceCancel(title: string, laneLabel: string): string {
  return `${title} returned to ${laneLabel}. Nothing changed.`
}
