'use client'

import Link from 'next/link'
import { Target, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  OBJECTIVE_HEALTH_LABELS,
  OBJECTIVE_HEALTH_BADGE,
  objectiveHealth,
} from '@/lib/utils/objectives'
import {
  useBoardDnd,
  BoardLiveRegion,
  DragHandle,
  BoardHint,
  type Lane,
} from '@/components/ui/board'
import type { Move } from '@/lib/ui/dnd'

export interface NowObjectiveItem {
  id: string
  title: string
  target_date: string | null
  health: string
  owner: { name: string; color: string | null } | null
  openTasks: number
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatTarget(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The one lane. A reorder list is a board with a single column. */
const NOW: Lane[] = [{ id: 'now', label: 'Now' }]

/**
 * The steering board's Now column, surfaced at the top of the Dashboard so the
 * morning read starts with "what we said matters" before "what's on fire".
 *
 * ── WHY IT IS DRAGGABLE AS OF 2026-10-26 ────────────────────────────────────
 * ⚠ THIS LIST IS NUMBERED, SO ITS ORDER IS A CLAIM — and until now the only
 * way to change that claim was to navigate to `/objectives` and drag it there.
 * The numbers come from `sort_order`, the dashboard reads the FULL `now`
 * bucket with no limit, and `/api/objectives/reorder` already existed and
 * already took exactly the payload a reorder produces. So the gesture was the
 * only missing piece: everything it needs was built, on three separate
 * surfaces, and never joined up (§12: check whether something already consumes
 * the answer you are about to start producing — here it already did).
 *
 * ⚠ AND IT IS THE ONE BOARD IN THE APP THAT IS `reorderable: true`. The three
 * stage boards all carry no order column, so their vertical gesture is
 * refused; `objectives` does carry one. That makes this the only surface
 * exercising that half of the primitive, which is why it is worth having.
 *
 * ⚠ THIS HALF HOLDS NO ROUTER AND NO FETCH, which is what keeps it renderable
 * in a test. `useRouter` throws outside a Next request, so a component reading
 * it cannot be exercised by `renderToStaticMarkup` — and this list carries the
 * numbering, the health chip, three optional meta fields and a drag handle per
 * row, which is exactly where an `undefined` reaches the markup unseen. The
 * wrapper beside it (`NowObjectives.tsx`) owns the router. That split is the
 * house pattern at this point rather than a one-off: `AttentionClient`,
 * `CommitmentsLedger` and `OpportunitiesClient` are all shaped this way (§12).
 */
export default function NowObjectivesList({
  items,
  onReorder,
}: {
  items: NowObjectiveItem[]
  /** Persists the new order. Throwing rolls the optimistic arrangement back. */
  onReorder: (move: Move) => Promise<void>
}) {
  const dnd = useBoardDnd<NowObjectiveItem>({
    lanes: NOW,
    items,
    laneOf: () => 'now',
    setLane: (o) => o,
    titleOf: (o) => o.title,
    // The one board that can: `objectives.sort_order` exists.
    reorderable: true,
    onMove: onReorder,
  })

  const shown = dnd.preview

  const lastRow = (n: number, cols: number) => (n % cols === 0 ? cols : n % cols)

  const wideColumns = lastRow(shown.length, 3) >= lastRow(shown.length, 2)
  const held = dnd.heldId ? shown.find((o) => o.id === dnd.heldId) : undefined

  if (items.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4 elev-1">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 label-caps text-muted-foreground">
          <Target size={13} /> Objectives — Now
        </div>
        <Link
          href="/objectives"
          className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Steering board <ArrowUpRight size={12} />
        </Link>
      </div>

      <BoardLiveRegion dnd={dnd} />

      {dnd.keyboard && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
          <span className="text-xs text-foreground">
            Holding <strong className="font-semibold">{held?.title ?? 'an objective'}</strong> — move it
            with the arrow keys.
          </span>
          <button
            type="button"
            onClick={() => dnd.cancelHold()}
            className="ml-auto h-[2.75rem] md:h-7 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Of the two widths, the one whose last row is fullest. A remainder of
          0 means the row is complete, so it beats any non-zero remainder. */}
      {/*
        ⚠ ONE COLUMN WHILE IT IS DRAGGABLE, NOT THREE. The resting layout is a
        3-up grid, which reads well — but a grid gives a vertical arrow press
        no meaning a reader can predict (does "down" mean the next cell or the
        next row?), and `applyMove` works in list order. So the list is the
        single source of order and the grid is the resting presentation; while
        a card is held it collapses to one column so the gesture matches what
        the eye sees.
      */}
      {/*
        ⚠ THE COLUMN COUNT IS CHOSEN SO THE LAST ROW IS NEVER AN ORPHAN. At a
        fixed `xl:grid-cols-3` four objectives render 3 + 1 — a lone card on
        its own row under a full one, which reads as a layout accident rather
        than as a list. Four is the live case and will stay common, since this
        panel is capped at a handful by design.
        The rule: of the two candidate widths, take the one that leaves the
        FULLEST last row (4 → 2 columns, 5 → 3, 6 → 3), preferring 3 on a tie.
        ⚠ Two LITERAL class strings, never `grid-cols-${n}` — a Tailwind class
        assembled at runtime is a class Tailwind never generated (§12).
      */}
      <ol
        {...dnd.laneProps('now')}
        className={cn(
          'grid gap-x-6 gap-y-2',
          dnd.dragging ? 'grid-cols-1' : wideColumns ? 'sm:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2',
          dnd.isDropTarget('now') && dnd.keyboard && 'rounded-md ring-2 ring-primary ring-offset-4 ring-offset-card'
        )}
      >
        {shown.map((o, i) => (
          <li
            key={o.id}
            {...dnd.cardProps(o.id, 'now', i)}
            className={cn(
              'relative flex items-start gap-2.5 min-w-0 rounded-md pr-8',
              // A ring, not a background — the panel owns `bg-card` (§12).
              dnd.draggingId === o.id && 'ring-2 ring-primary opacity-60'
            )}
          >
            <span className="shrink-0 mt-0.5 inline-flex items-center justify-center size-5 rounded-full bg-muted text-[11px] font-semibold tnum text-muted-foreground">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {o.title}
                {objectiveHealth(o.health) !== 'on_track' && (
                  <span
                    className={cn(
                      'ml-1.5 inline-flex items-center rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide ring-1 ring-inset align-middle',
                      OBJECTIVE_HEALTH_BADGE[objectiveHealth(o.health)],
                    )}
                  >
                    {OBJECTIVE_HEALTH_LABELS[objectiveHealth(o.health)]}
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {o.owner && <span>{initials(o.owner.name)}</span>}
                {o.target_date && <span className="tnum">by {formatTarget(o.target_date)}</span>}
                {o.openTasks > 0 && (
                  <span className="tnum">
                    {o.openTasks} open task{o.openTasks !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            {/* A SIBLING of nothing clickable here — the row is not a link, so
                the handle simply sits in the row's own right-hand gutter. */}
            <DragHandle dnd={dnd} id={o.id} laneId="now" index={i} className="top-0 right-0 md:top-0.5" />
          </li>
        ))}
      </ol>

      {/* Only worth saying once there is something to reorder. */}
      {items.length > 1 && <BoardHint dnd={dnd} noun="objective" className="mt-3" />}
    </div>
  )
}
