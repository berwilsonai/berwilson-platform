'use client'

/**
 * The board primitive: one drag implementation for every board in the app.
 *
 * Replaces three hand-rolled copies of native HTML5 drag
 * (`SteelPipelineBoard`, `ObjectivesBoard`, `OrgStructureBoard`) and gives the
 * affordance to the two boards that never had it — `/projects`'s pipeline and
 * `TeamTaskBoard`, the two highest-traffic boards in the application.
 *
 * All the logic lives in `src/lib/ui/dnd.ts`, which is pure and tested. This
 * file is the React skin: event wiring, ARIA, and the classes.
 *
 * ── WHAT THE THREE COPIES ALL GOT WRONG ─────────────────────────────────────
 * They are POINTER-ONLY. The steel board admits it in its own footer — *"On a
 * phone, open a deal to change its stage"* — so the feature is absent on the
 * device Richard carries and absent for a keyboard entirely. That is the same
 * class of defect as a hover-only control (§12), and it is why this hook is
 * built keyboard-first with the pointer as a second caller.
 *
 * ── HOW A BOARD USES IT ─────────────────────────────────────────────────────
 *   const dnd = useBoardDnd({ lanes, items, laneOf, setLane, titleOf, onMove })
 *   const shown = dnd.preview            // items in their TENTATIVE order
 *   ...
 *   <BoardLiveRegion dnd={dnd} />
 *   <div {...dnd.laneProps('bidding')}>
 *     {cards.map((c, i) => (
 *       <div {...dnd.cardProps(c.id, 'bidding', i)}>
 *         <a href={...}>…</a>
 *         <DragHandle dnd={dnd} id={c.id} laneId="bidding" index={i} />
 *       </div>
 *     ))}
 *   </div>
 *
 * The layout stays the board's own — the five boards look nothing like each
 * other and converging their markup was never the goal. What converges is the
 * BEHAVIOUR: the same keys, the same announcements, the same drop semantics.
 */

import * as React from 'react'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  laneStep,
  indexStep,
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
  type Move,
} from '@/lib/ui/dnd'

export type { Lane } from '@/lib/ui/dnd'

interface UseBoardDndArgs<T extends { id: string }> {
  lanes: readonly Lane[]
  items: readonly T[]
  laneOf: (item: T) => string
  setLane: (item: T, laneId: string) => T
  titleOf: (item: T) => string
  /**
   * Commit. Called ONCE per drag, never on an intermediate arrow press, and
   * never for a drop that changed nothing. Throwing (or rejecting) rolls the
   * optimistic arrangement back, so a failed PATCH puts the card where it was
   * rather than leaving the screen disagreeing with the database.
   */
  onMove: (move: Move) => void | Promise<void>
  /** Set false to render a read-only board (no handles, no drop targets). */
  enabled?: boolean
  /**
   * Can an item be reordered WITHIN its lane, or only moved between lanes?
   *
   * ⚠ THIS IS A SCHEMA QUESTION, NOT A TASTE ONE. A within-lane reorder can
   * only persist where the table carries an order column: `objectives` has
   * `sort_order`, `projects` and `tasks` have nothing. On those two, a vertical
   * drag would animate, hold optimistically, and snap back on the next server
   * render — so the gesture refuses instead. Default false, because that is the
   * SAFE answer: a board that forgets to opt in loses a nicety, where one that
   * forgets to opt out tells the reader something untrue.
   */
  reorderable?: boolean
}

export interface BoardDnd<T extends { id: string }> {
  /** Items in their TENTATIVE arrangement — group by lane and render these. */
  preview: T[]
  /** True while any drag (pointer or keyboard) is in flight. */
  dragging: boolean
  /** The id being dragged, for a dimmed/held style. */
  draggingId: string | null
  /** True when this lane is the current drop target. */
  isDropTarget: (laneId: string) => boolean
  /**
   * True when the drag is being HELD — grabbed by a key press or a tap and
   * waiting for a destination, rather than following a pointer. Lanes use this
   * to offer themselves as tap targets, which is what makes the feature work
   * on a touch screen at all.
   */
  keyboard: boolean
  /** The id currently held, if any. Null during a pointer drag. */
  heldId: string | null
  laneProps: (laneId: string) => React.HTMLAttributes<HTMLElement>
  cardProps: (id: string, laneId: string, index: number) => React.HTMLAttributes<HTMLElement> & { 'data-dragging'?: string }
  handleProps: (id: string, laneId: string, index: number) => React.ButtonHTMLAttributes<HTMLButtonElement>
  /**
   * Release a held card without moving it. The escape key does this too, but
   * only while the handle still has focus — a thumb that tapped to grab has no
   * key to press, so a board offering tap-to-move must also offer a visible
   * way out or the gesture is a trap.
   */
  cancelHold: () => void
  /**
   * Which arrow keys actually do something on THIS board, as a phrase.
   *
   * ⚠ THE HOOK OWNS THIS BECAUSE THE CALLER GOT IT WRONG. `BoardHint` first
   * took a `reorderable` prop that had to be kept in sync with the hook's own
   * flag by hand — a hand-written enumeration beside a registry, which §12
   * says drifts, and whose drift here is a hint naming a key that does
   * nothing. Only the hook knows both `reorderable` AND how many lanes there
   * are, and a one-lane reorder list has no horizontal move at all.
   */
  keyHint: string
  /** What a screen reader is being told right now. */
  announcement: string
  enabled: boolean
}

export function useBoardDnd<T extends { id: string }>({
  lanes,
  items,
  laneOf,
  setLane,
  titleOf,
  onMove,
  enabled = true,
  reorderable = false,
}: UseBoardDndArgs<T>): BoardDnd<T> {
  const [drag, setDrag] = React.useState<DragState | null>(null)
  /*
    ⚠ A REF BESIDE THE STATE, AND IT IS LOAD-BEARING FOR THE TOUCH PATH.
    `onBlur` on the handle has to cancel a held card — tabbing away must not
    leave the board holding something no key can reach. But a tap on a lane
    BLURS THE HANDLE FIRST, so a blur handler reading `drag` from its own
    closure would cancel the drag microseconds before the lane could receive
    it, and tap-to-move would never work once. The ref is written eagerly by
    every transition, so the blur reads what is true NOW rather than what was
    true when its closure was built.
  */
  const dragRef = React.useRef<DragState | null>(null)
  const hold = React.useCallback((next: DragState | null) => {
    dragRef.current = next
    setDrag(next)
  }, [])
  const [keyboard, setKeyboard] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState('')
  /**
   * The arrangement an in-flight drag is proposing, and the one a committed
   * drag is holding until the server agrees. Kept apart from `items` so a
   * re-render from the server does not fight the drag.
   */
  const [optimistic, setOptimistic] = React.useState<T[] | null>(null)

  // A server refresh is the authority: once new props arrive, drop the
  // optimistic copy. Comparing by id+lane rather than by reference, because a
  // server component hands back a fresh array on every refresh.
  const signature = items.map((it) => `${it.id}:${laneOf(it)}`).join('|')
  const committed = React.useRef(signature)
  React.useEffect(() => {
    if (committed.current !== signature) {
      committed.current = signature
      setOptimistic(null)
    }
  }, [signature])

  /*
    Memoized because three hooks below depend on it: a fresh array literal each
    render would re-create `preview`, `finish` and every lane handler on every
    pass, which on a 300-card board is the difference between a drag that
    tracks the cursor and one that stutters.
  */
  const base = React.useMemo(() => optimistic ?? [...items], [optimistic, items])

  const laneLabel = React.useCallback(
    (id: string) => lanes.find((l) => l.id === id)?.label ?? id,
    [lanes]
  )
  const titleFor = React.useCallback(
    (id: string) => {
      const found = base.find((it) => it.id === id)
      return found ? titleOf(found) : 'Item'
    },
    [base, titleOf]
  )

  /** Items as the board should render them right now. */
  const preview = React.useMemo(() => {
    if (!drag) return base
    const move = commitMove(drag)
    if (!move) return base
    return applyMove(base, move, setLane, laneOf)
  }, [base, drag, setLane, laneOf])

  const countIn = React.useCallback(
    (laneId: string) => preview.filter((it) => laneOf(it) === laneId).length,
    [preview, laneOf]
  )

  const finish = React.useCallback(
    async (state: DragState) => {
      const move = commitMove(state)
      hold(null)
      setKeyboard(false)
      if (!move) {
        setAnnouncement(announceCancel(titleFor(state.itemId), laneLabel(state.fromLaneId)))
        return
      }
      const next = applyMove(base, move, setLane, laneOf)
      setOptimistic(next)
      setAnnouncement(
        announceDrop(titleFor(state.itemId), laneLabel(move.fromLaneId), laneLabel(move.toLaneId))
      )
      try {
        await onMove(move)
      } catch {
        // Roll back rather than leave the screen disagreeing with the database.
        setOptimistic(null)
        setAnnouncement(
          `${titleFor(state.itemId)} could not be moved. It is back in ${laneLabel(move.fromLaneId)}.`
        )
      }
    },
    [base, laneOf, laneLabel, onMove, setLane, titleFor, hold]
  )

  const cancel = React.useCallback(
    (state: DragState) => {
      hold(null)
      setKeyboard(false)
      setAnnouncement(announceCancel(titleFor(state.itemId), laneLabel(state.fromLaneId)))
    },
    [laneLabel, titleFor, hold]
  )

  // ── pointer ───────────────────────────────────────────────────────────────

  const laneProps = React.useCallback(
    (laneId: string): React.HTMLAttributes<HTMLElement> => {
      if (!enabled) return {}
      return {
        onDragOver: (e) => {
          if (!drag || keyboard) return
          e.preventDefault()
          if (drag.laneId === laneId) return
          // Entering a new lane lands at its end, which is what a pointer drop
          // onto a column (rather than between two cards) means.
          hold({ ...drag, laneId, index: countIn(laneId) })
        },
        onDrop: (e) => {
          if (!drag || keyboard) return
          e.preventDefault()
          void finish({ ...drag, laneId, index: drag.laneId === laneId ? drag.index : countIn(laneId) })
        },
        /*
          ⚠ THE TOUCH PATH, AND IT IS THE WHOLE REASON THIS IS NOT POINTER-ONLY.
          Native HTML5 drag does not fire on a touch screen at all — which is
          why all three hand-rolled boards told the reader to "open a deal to
          change its stage" on a phone. A tap on the handle HOLDS the card
          (`keyboard: true` — the state is about being held, not about which
          key did it), and then a tap on a lane drops it there. So one reducer
          serves a mouse, a keyboard and a thumb instead of just the first.
        */
        onPointerDown: () => {
          const live = dragRef.current
          if (!live || !keyboard) return
          void finish({ ...live, laneId, index: live.laneId === laneId ? live.index : countIn(laneId) })
        },
      }
    },
    [drag, keyboard, enabled, countIn, finish, hold]
  )

  const cardProps = React.useCallback(
    (id: string, laneId: string, index: number) => {
      if (!enabled) return {}
      return {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          e.dataTransfer.effectAllowed = 'move'
          // Firefox will not start a drag without data on the transfer.
          e.dataTransfer.setData('text/plain', id)
          setKeyboard(false)
          hold({ itemId: id, fromLaneId: laneId, fromIndex: index, laneId, index })
        },
        onDragEnd: () => {
          // A drop outside any lane fires dragend with no drop: treat it as a
          // cancel rather than leaving the board stuck in a dragging state.
          if (dragRef.current?.itemId === id) hold(null)
          setKeyboard(false)
        },
        onDragOver: (e: React.DragEvent) => {
          if (!drag || keyboard || drag.itemId === id) return
          e.preventDefault()
          e.stopPropagation()
          // Hovering a specific card is a request for THAT position — but
          // only where a position is a thing that can be saved.
          if (!reorderable) {
            if (drag.laneId !== laneId) hold({ ...drag, laneId, index: countIn(laneId) })
            return
          }
          if (drag.laneId !== laneId || drag.index !== index) {
            hold({ ...drag, laneId, index })
          }
        },
        'data-dragging': drag?.itemId === id ? 'true' : undefined,
      } as React.HTMLAttributes<HTMLElement> & { 'data-dragging'?: string }
    },
    [drag, keyboard, enabled, reorderable, countIn, hold]
  )

  // ── keyboard ──────────────────────────────────────────────────────────────

  const heldItemId = drag?.itemId ?? null
  const handleProps = React.useCallback(
    (id: string, laneId: string, index: number): React.ButtonHTMLAttributes<HTMLButtonElement> => {
      if (!enabled) return { hidden: true }
      const held = keyboard && heldItemId === id
      return {
        type: 'button',
        'aria-label': held ? `Moving ${titleFor(id)}` : `Move ${titleFor(id)}`,
        'aria-pressed': held,
        // Names the gesture for a screen reader, which otherwise hears only
        // "button" and has no way to know a drag is available.
        'aria-roledescription': 'drag handle',
        /*
          A tap is the same verb as space. ⚠ And it cannot double-fire with the
          key handler below: a <button> turns space and enter into a click, but
          both branches there call preventDefault(), which suppresses it.
        */
        // Keeps the handle's own tap from reaching the lane's pointerdown,
        // which would drop the card at the lane's end instead of toggling.
        onPointerDown: (e) => { e.stopPropagation() },
        onClick: (e) => {
          e.preventDefault()
          e.stopPropagation()
          const cur = dragRef.current && dragRef.current.itemId === id ? dragRef.current : null
          if (!cur) {
            setKeyboard(true)
            hold({ itemId: id, fromLaneId: laneId, fromIndex: index, laneId, index })
            setAnnouncement(
              reorderable
                ? announceGrab(titleFor(id), laneLabel(laneId), index, countIn(laneId))
                : announceGrabLaneOnly(titleFor(id), laneLabel(laneId))
            )
          } else {
            void finish(cur)
          }
        },
        onKeyDown: (e) => {
          const cur = dragRef.current && dragRef.current.itemId === id ? dragRef.current : null

          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            if (!cur) {
              const start: DragState = { itemId: id, fromLaneId: laneId, fromIndex: index, laneId, index }
              setKeyboard(true)
              hold(start)
              setAnnouncement(
                reorderable
                  ? announceGrab(titleFor(id), laneLabel(laneId), index, countIn(laneId))
                  : announceGrabLaneOnly(titleFor(id), laneLabel(laneId))
              )
            } else {
              void finish(cur)
            }
            return
          }

          if (!cur) return

          if (e.key === 'Escape') {
            e.preventDefault()
            cancel(cur)
            return
          }

          const horizontal = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
          const vertical = reorderable ? (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0) : 0
          if (!horizontal && !vertical) return

          // Arrows scroll the page by default, which under a drag reads as the
          // board moving instead of the card.
          e.preventDefault()

          let next: DragState
          if (horizontal) {
            const toLane = laneStep(lanes, cur.laneId, horizontal as -1 | 1)
            if (toLane === cur.laneId) return
            // Landing in a new lane goes to its end — the same semantics as a
            // pointer dropping onto a column.
            next = { ...cur, laneId: toLane, index: countIn(toLane) }
          } else {
            const within = countIn(cur.laneId)
            const toIndex = indexStep(within, cur.index, vertical as -1 | 1)
            if (toIndex === cur.index) return
            next = { ...cur, index: toIndex }
          }
          hold(next)
          setAnnouncement(
            reorderable
              ? announceMove(titleFor(id), laneLabel(next.laneId), next.index, countIn(next.laneId))
              : announceMoveLaneOnly(titleFor(id), laneLabel(next.laneId))
          )
        },
        onBlur: () => {
          /*
            Tabbing away mid-drag must not leave the board holding a card no
            key can reach. Reads the REF: a tap on a lane blurs this handle
            before the lane's own handler runs, so a closure read would cancel
            the drop that was about to happen.
          */
          const live = dragRef.current
          if (live && live.itemId === id) cancel(live)
        },
      }
    },
    [keyboard, enabled, reorderable, lanes, countIn, titleFor, laneLabel, finish, cancel, hold, heldItemId]
  )

  return {
    preview,
    dragging: drag !== null,
    draggingId: drag?.itemId ?? null,
    isDropTarget: (laneId: string) => drag !== null && drag.laneId === laneId,
    keyboard,
    heldId: keyboard ? (drag?.itemId ?? null) : null,
    cancelHold: () => {
      const live = dragRef.current
      if (live) cancel(live)
    },
    keyHint:
      lanes.length <= 1
        ? reorderable
          ? 'the up and down arrow keys'
          : // One lane and no reorder is a board with nowhere to go. Nothing
            // should render a hint in that case; saying so is better than a
            // sentence naming no key at all.
            'no keys — there is nowhere to move it'
        : reorderable
          ? 'the arrow keys'
          : 'the left and right arrow keys',
    laneProps,
    cardProps,
    handleProps,
    announcement,
    enabled,
  }
}

// ─── presentational bits ─────────────────────────────────────────────────────

/**
 * The live region. One per board.
 *
 * `assertive`, not `polite`: an arrow press needs to be read NOW, and a polite
 * region queues behind whatever is already speaking, so a run of key presses
 * arrives after the drag has finished.
 */
export function BoardLiveRegion<T extends { id: string }>({ dnd }: { dnd: BoardDnd<T> }) {
  return (
    <div aria-live="assertive" aria-atomic="true" className="sr-only">
      {dnd.announcement}
    </div>
  )
}

/**
 * The drag handle.
 *
 * ⚠ IT MUST NOT BE A DESCENDANT OF THE CARD'S LINK. §12: a `<button>` inside
 * an `<a>` fires BOTH, which is what forced `/attention`'s rows from Link to
 * div. So a board card is a positioned wrapper holding the anchor and this
 * handle as SIBLINGS — the anchor still covers the card body for a click, and
 * the handle floats above it.
 *
 * ⚠ AND IT NEVER DEPENDS ON HOVER AT ALL. A control that only appears on hover
 * does not exist on a phone (§12), and this one is the only route to a drag. It
 * sits at low contrast at rest and strengthens on its OWN hover and focus —
 * deliberately NOT on the card's `group-hover`, for two reasons. The weaker one
 * is that hover-reveal is the bug. The load-bearing one is that the five boards
 * name their groups differently (`group/card` on a project, bare `group` on a
 * steel deal), and `group-hover/${name}:` cannot be built by interpolation —
 * a Tailwind class assembled at runtime is a class Tailwind never generated
 * (§12). A shared handle that took a group name would silently render with no
 * reveal on whichever board spelled it differently.
 */
export function DragHandle<T extends { id: string }>({
  dnd,
  id,
  laneId,
  index,
  inline = false,
  className,
}: {
  dnd: BoardDnd<T>
  id: string
  laneId: string
  index: number
  /**
   * Render as a flex item rather than positioned in the corner. A board CARD
   * wants the corner; a list ROW wants the handle sitting in the row beside its
   * other actions, where absolute positioning would overlap the text.
   */
  inline?: boolean
  className?: string
}) {
  if (!dnd.enabled) return null
  const held = dnd.keyboard && dnd.draggingId === id
  return (
    <button
      {...dnd.handleProps(id, laneId, index)}
      className={cn(
        // A touch target is a PHYSICAL constraint, so it is absolute and never
        // a spacing step — `size-11` is calc(--spacing * 11) and went below the
        // 44px floor when density tightened (§12). Compact from md up, where a
        // pointer does not need 44px.
        'z-10 inline-flex items-center justify-center rounded-md',
        inline ? 'shrink-0' : 'absolute top-0 right-0',
        'size-[2.75rem] md:size-7',
        'text-muted-foreground/40 hover:text-foreground hover:bg-accent',
        'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        'transition-colors cursor-grab active:cursor-grabbing touch-none',
        held && 'text-primary bg-accent',
        className
      )}
    >
      <GripVertical size={14} aria-hidden="true" />
    </button>
  )
}

/**
 * The one-line instruction a board prints under itself.
 *
 * Worth a shared component because the wording is the only documentation this
 * feature has, and three boards had three different sentences — one of which
 * told the reader the feature did not work on their phone.
 */
export function BoardHint<T extends { id: string }>({
  dnd,
  noun = 'card',
  className,
}: {
  /** The phrase comes from the hook, so it cannot disagree with the keys. */
  dnd: BoardDnd<T>
  noun?: string
  className?: string
}) {
  if (!dnd.enabled) return null
  return (
    <p className={cn('label-caps text-muted-foreground/70 normal-case tracking-normal', className)}>
      Drag a {noun}, or focus its handle and use {dnd.keyHint}.
    </p>
  )
}
