'use client'

/**
 * The opportunities pipeline board.
 *
 * ⚠ `OPPORTUNITY_PIPELINE` HAS EXISTED ALL ALONG AND HAD NEVER BEEN RENDERED
 * AS A PIPELINE. Measured 2026-10-26: six ordered stages declared in
 * `src/lib/utils/opportunities.ts`, read by the detail layout, the milestones
 * page and `records/live.ts` — and by nothing that draws a board.
 * `/opportunities` was a flat grid of cards, so the one surface where the order
 * of those stages is the information did not show it. §12's own note about
 * this shape is the third bullet under UI: a consumer written for a producer
 * that never existed, and here it is the mirror — a producer with no consumer.
 *
 * Cards come from `OpportunityCard`, the same component the grid uses, with
 * `compact` as the target parameter (§12: never fork a shared pass).
 */

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { Opportunity } from '@/lib/supabase/types'
import { formatValue } from '@/lib/utils/constants'
import {
  oppStage,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_STAGE_BADGE,
  STAGE_CLOSED,
} from '@/lib/utils/opportunities'
import { pipelineTotal, coverageNote, leafRecords } from '@/lib/records/pipeline-value'
import { powerTotal, type PowerPhase, type PowerTotal } from '@/lib/records/power'
import { PowerFigure } from '@/components/records/PowerFigure'
import { useBoardDnd, BoardLiveRegion, BoardHint, type Lane, type BoardDnd } from '@/components/ui/board'
import { OpportunityCard } from './OpportunityCards'
import type { DealStage } from '@/lib/supabase/types'

/**
 * The terminal states. Shown — a funnel with a missing rung misleads (the same
 * argument `/projects` makes for keeping an empty stage visible) — but muted,
 * because they are where deals go to stop rather than somewhere to work.
 */
/*
 * ⚠ TWO MEMBERS NOW, AND `on_hold` IS NOT ONE OF THEM. This set held
 * on_hold / closed_won / closed_passed, from the days when `status` carried
 * both the pipeline AND whether the deal was parked. Parking moved to its own
 * column on 10-30, so a parked deal keeps its real pipeline lane instead of
 * being swept into a terminal column — which is what you want: an on-hold deal
 * in Due Diligence is still a Due Diligence deal, and hiding that was how the
 * board under-reported the live funnel.
 */
const TERMINAL: ReadonlySet<DealStage> = new Set<DealStage>(STAGE_CLOSED)

export default function OpportunityBoard({
  opportunities,
  canDelete = false,
  onDeleted,
  onMoved,
  powerOf,
}: {
  opportunities: Opportunity[]
  canDelete?: boolean
  onDeleted?: (id: string) => void
  /** Persists a status change. Throwing rolls the card back. */
  onMoved: (id: string, status: DealStage) => Promise<void>
  /** One record's ramp phases, by id. Absent = no schedules to show. */
  powerOf?: (recordId: string) => readonly PowerPhase[]
}) {
  const lanes: Lane[] = useMemo(
    () =>
      OPPORTUNITY_STAGES.map((st) => ({
        id: st,
        label: OPPORTUNITY_STAGE_LABELS[st],
      })),
    []
  )

  const dnd = useBoardDnd<Opportunity>({
    lanes,
    items: opportunities,
    laneOf: (o) => oppStage(o.stage),
    setLane: (o, laneId) => ({ ...o, status: laneId as DealStage }),
    titleOf: (o) => o.name,
    /*
      ⚠ `opportunities` carries no order column, exactly as `projects` does
      not, so a within-status reorder could not survive a refresh. The hook
      refuses the vertical gesture rather than animating a lie.
    */
    reorderable: false,
    onMove: async (move) => {
      await onMoved(move.itemId, move.toLaneId as DealStage)
    },
  })

  const byStatus = useMemo(() => {
    const groups = new Map<DealStage, Opportunity[]>()
    for (const o of dnd.preview) {
      const st = oppStage(o.stage)
      const arr = groups.get(st) ?? []
      arr.push(o)
      groups.set(st, arr)
    }
    return groups
  }, [dnd.preview])

  /*
    Which opportunities carry the pipeline's value: every one with no child
    present. Built over the whole set once and used by every column total, so
    the columns cannot sum to more than the pipeline does — the same rule
    `/projects` applies, and for the same reason (a parent and its children
    usually sit in different stages).
  */
  const leafIds = useMemo(
    () => new Set(leafRecords(opportunities).map((o) => o.id)),
    [opportunities]
  )

  const held = dnd.heldId ? dnd.preview.find((o) => o.id === dnd.heldId) : undefined

  return (
    <div className="space-y-3">
      <BoardLiveRegion dnd={dnd} />

      {/* The exit from a tap-grab. Escape only works while the handle has
          focus, so a thumb needs a visible way out. */}
      {dnd.keyboard && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
          <span className="text-xs text-foreground">
            Holding <strong className="font-semibold">{held?.name ?? 'an opportunity'}</strong> — choose a
            stage to move it to.
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

      <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
        {OPPORTUNITY_STAGES.map((st) => {
          const items = byStatus.get(st) ?? []
          const empty = items.length === 0
          const terminal = TERMINAL.has(st)
          const colItems = items.filter((o) => leafIds.has(o.id))
          const total = pipelineTotal(colItems)
          const note = coverageNote(total)
          // The stage's capacity, on the same leaf-filtered set the money
          // total uses — so the two aggregates above a column describe the
          // same deals.
          const power = powerOf
            ? powerTotal(colItems.flatMap((o) => [...powerOf(o.id)]))
            : null

          return (
            <BoardColumn
              key={st}
              status={st}
              items={items}
              empty={empty}
              terminal={terminal}
              total={total}
              note={note}
              power={power}
              powerOf={powerOf}
              dnd={dnd}
              canDelete={canDelete}
              onDeleted={onDeleted}
            />
          )
        })}
      </div>

      <BoardHint dnd={dnd} noun="opportunity" />
    </div>
  )
}

function BoardColumn({
  status,
  items,
  empty,
  terminal,
  total,
  note,
  power,
  powerOf,
  dnd,
  canDelete,
  onDeleted,
}: {
  status: DealStage
  items: Opportunity[]
  empty: boolean
  terminal: boolean
  total: ReturnType<typeof pipelineTotal>
  note: string | null
  /** The stage's total capacity, or null when nothing here is scheduled. */
  power: PowerTotal | null
  /** One record's phases, by id — handed to each card. */
  powerOf?: (recordId: string) => readonly PowerPhase[]
  dnd: BoardDnd<Opportunity>
  canDelete?: boolean
  onDeleted?: (id: string) => void
}) {
  const target = dnd.isDropTarget(status)
  return (
    <div
      {...dnd.laneProps(status)}
      className={cn(
        'flex flex-col shrink-0 rounded-lg transition-all',
        // An empty column collapses so nine stages fit, and opens while a drag
        // is in flight so it can actually receive a card.
        empty ? (dnd.dragging ? 'w-[180px]' : 'w-[3rem]') : 'w-[272px]',
        // ⚠ A ring, never a bg — the header and body below own their
        // backgrounds and `cn()` is tailwind-merge (§12).
        target && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
    >
      {/*
        ⚠ A COLLAPSED COLUMN TURNS ITS LABEL RATHER THAN SHRINKING IT. At 96px
        with `text-xs truncate` the four empty stages read "Due Dilig…" and
        "Evaluat…" — a column whose only content was a cut-off word, which is
        worse than the wide empty column it replaced. Rotated it fits whole in
        3rem and the board gets 45px back per empty stage on top of that.
        Top-aligned deliberately: the column is as tall as the fullest one, so
        a centred label sits below the fold. Same shape as the steel board.
      */}
      {empty && !dnd.dragging ? (
        <div className="flex h-full justify-center rounded-lg border border-border bg-muted/30 pt-2.5">
          <h2
            className={cn(
              'whitespace-nowrap text-xs font-semibold [writing-mode:vertical-rl]',
              terminal ? 'text-muted-foreground' : 'text-foreground'
            )}
          >
            {OPPORTUNITY_STAGE_LABELS[status]}
          </h2>
        </div>
      ) : (
      <>
      <div
        className={cn(
          'sticky top-0 z-10 rounded-t-lg border border-b-0 border-border px-3 py-2.5 backdrop-blur',
          terminal ? 'bg-muted/60' : 'bg-muted/40'
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <h2
            className={cn(
              'font-semibold min-w-0 truncate',
              empty ? 'text-xs' : 'text-sm',
              terminal ? 'text-muted-foreground' : 'text-foreground'
            )}
          >
            {OPPORTUNITY_STAGE_LABELS[status]}
          </h2>
          {!empty && (
            <span
              className={cn(
                'ml-auto inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                OPPORTUNITY_STAGE_BADGE[status]
              )}
            >
              {items.length}
            </span>
          )}
        </div>
        {/* An empty column has no total worth stating; "$0" is noise dressed
            as a figure. */}
        {/*
          ⚠ THE LINE IS OMITTED WHEN THERE IS NO TOTAL, rather than printing
          "Not set" with "none of 4 priced" under it. One deal in thirty
          carries an `estimated_value`, so on this board that pair was the
          most repeated element on the screen — two lines of chrome, on every
          column, saying nothing twice. The aggregate is the main reason to
          look at a board; a column that cannot state one should say nothing
          and let the cards have the room (§12: omit the row, or name the
          absence in words — never both, and never on every row).
        */}
        {/* ⚠ CAPACITY FIRST, AND SILENT WHEN ABSENT — the same rule the
            money line below already follows, and for the same measured
            reason: a figure nobody has entered must not become the most
            repeated element on the board. */}
        {!empty && power?.megawatts != null && (
          <div className="mt-1.5 text-xs">
            <PowerFigure total={power} />
          </div>
        )}
        {!empty && total.estimated > 0 && (
          <div className="mt-1.5 text-xs">
            <span
              className="font-semibold tnum text-foreground"
              title={note ? `${note} in this stage` : undefined}
            >
              {formatValue(total.amount)}
            </span>
            {note && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{note}</p>}
          </div>
        )}
      </div>

      <div
        className={cn(
          'flex-1 space-y-2 rounded-b-lg border border-t-0 border-border p-2 min-h-[120px]',
          terminal ? 'bg-muted/20' : 'bg-muted/10'
        )}
      >
        {items.map((opp, i) => (
          <OpportunityCard
            powerOf={powerOf ? (id) => powerTotal(powerOf(id)) : undefined}
            key={opp.id}
            opp={opp}
            compact
            canDelete={canDelete}
            onDeleted={onDeleted}
            dnd={dnd}
            laneId={status}
            index={i}
          />
        ))}
      </div>
      </>
      )}
    </div>
  )
}
