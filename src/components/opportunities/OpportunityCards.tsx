'use client'

import Link from 'next/link'
import { MapPin, Building2, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Opportunity } from '@/lib/supabase/types'
import { formatValue, formatDate, SECTOR_LABELS } from '@/lib/utils/constants'
import { PowerFigure } from '@/components/records/PowerFigure'
import type { PowerTotal } from '@/lib/records/power'
import type { ProjectSector } from '@/lib/supabase/types'
import {
  oppType,
  oppStage,
  oppPriority,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_TYPE_BADGE,
  OPPORTUNITY_TYPE_BORDER,
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_STAGE_BADGE,
  OPPORTUNITY_PRIORITY_BADGE,
  OPPORTUNITY_PRIORITY_LABELS,
} from '@/lib/utils/opportunities'
import { pipelineValue } from '@/lib/records/pipeline-value'
import RecordDeleteButton from '@/components/shared/RecordDeleteButton'
import { DragHandle, type BoardDnd } from '@/components/ui/board'

export interface OpportunityCardsProps {
  opportunities: Opportunity[]
  /**
   * Whether this viewer may delete. The routes are admin-only, so without this
   * a project manager would get a button that always answers 403 — §12: null
   * renders no button at all rather than a dead one.
   */
  canDelete?: boolean
  /** Supplied by `OpportunitiesClient`, which owns the state; see there. */
  onDeleted?: (id: string) => void
  /** The ramp-up total for one record, by id. Absent = nothing to show. */
  powerOf?: (recordId: string) => PowerTotal
}

/**
 * The opportunity cards, with no knowledge of the router or of fetch.
 *
 * ⚠ KEPT RENDERABLE IN A TEST, which is why the delete state lives in the
 * wrapper. `useRouter` throws outside a Next request, so a component that reads
 * it cannot be exercised by `renderToStaticMarkup` — and these cards carry nine
 * conditional fields, which is exactly where an `undefined` or a bare em dash
 * reaches the markup unnoticed.
 *
 * ⚠ THE CARD IS NO LONGER THE `<Link>` ITSELF — IT IS A WRAPPER AROUND IT. A
 * `<button>` inside an `<a>` is invalid HTML and browsers resolve it by firing
 * BOTH, so a delete nested in the old structure would have navigated to the
 * opportunity mid-request, with `tsc`, the build and a glance all clean. The
 * wrapper is `relative group/card` so the corner button can position against
 * it and reveal on hover or focus; `/projects` already solves it this way, and
 * matching that beats inventing a fourth pattern.
 */
export default function OpportunityCards({
  opportunities,
  canDelete = false,
  onDeleted,
  powerOf,
}: OpportunityCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {opportunities.map((opp) => (
        <OpportunityCard
          key={opp.id}
          opp={opp}
          canDelete={canDelete}
          onDeleted={onDeleted}
          powerOf={powerOf}
        />
      ))}
    </div>
  )
}

/**
 * ONE opportunity card, used by the grid above and by the pipeline board.
 *
 * ⚠ EXTRACTED RATHER THAN COPIED. §12: never fork a shared pass — add a
 * target. A board needs the same nine conditional fields in a narrower column,
 * and a second copy of this markup is a second place for a bare em dash or an
 * `undefined` to reach a reader. `compact` is the target parameter; the drag
 * props are the second.
 */
export function OpportunityCard({
  opp,
  canDelete = false,
  onDeleted,
  powerOf,
  compact = false,
  dnd,
  laneId,
  index,
}: {
  opp: Opportunity
  canDelete?: boolean
  onDeleted?: (id: string) => void
  /**
   * The ramp-up total for one record, by id.
   *
   * ⚠ A FUNCTION AND NOT A FIGURE, because this component is shared by the
   * grid AND the board (`compact` is the target parameter) and both want the
   * same lookup rather than each pre-computing per card. Absent = the caller
   * has no schedules to show, and the figure is simply not rendered.
   */
  powerOf?: (recordId: string) => PowerTotal
  /** Narrow-column styling for the board: tighter padding, fewer meta rows. */
  compact?: boolean
  /** Present only on the board. */
  dnd?: BoardDnd<Opportunity>
  laneId?: string
  index?: number
}) {
  const t = oppType(opp.opp_type)
  const s = oppStage(opp.stage)
  const p = oppPriority(opp.priority)
  const draggable = dnd && laneId !== undefined && index !== undefined
  const held = draggable && dnd.draggingId === opp.id

  return (
          <div
            {...(draggable ? dnd.cardProps(opp.id, laneId, index) : {})}
            className={cn(
              'relative group/card',
              // A ring, not a background: the card below owns `bg-card` and
              // `cn()` is tailwind-merge, so a bg here would delete it (§12).
              held && 'ring-2 ring-primary rounded-lg opacity-60'
            )}
          >
            <Link
              href={`/opportunities/${opp.id}`}
              className={cn(
                'group block rounded-lg border border-border border-l-[3px] bg-card elev-1 lift transition-colors',
                compact ? 'p-2.5' : 'p-4',
                OPPORTUNITY_TYPE_BORDER[t]
              )}
            >
              {/* Header: type + status */}
              <div className="flex items-center gap-1.5 flex-wrap mb-2">
                <span
                  className={cn(
                    'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                    OPPORTUNITY_TYPE_BADGE[t]
                  )}
                >
                  {OPPORTUNITY_TYPE_LABELS[t]}
                </span>
                {/* A column that IS the status does not need the chip too —
                    §12: never print the same quantity twice on one screen. */}
                {!compact && (
                  <span
                    className={cn(
                      'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                      OPPORTUNITY_STAGE_BADGE[s]
                    )}
                  >
                    {OPPORTUNITY_STAGE_LABELS[s]}
                  </span>
                )}
                {p === 'high' && (
                  <span
                    className={cn(
                      'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                      OPPORTUNITY_PRIORITY_BADGE[p]
                    )}
                  >
                    {OPPORTUNITY_PRIORITY_LABELS[p]}
                  </span>
                )}
              </div>

              {/* Name — and beside it the key metric (Richard, 10-30). The
                  figure renders nothing where there is no ramp schedule, so a
                  deal without one looks exactly as it did. */}
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 text-sm font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
                  {opp.name}
                </h3>
                {powerOf ? <PowerFigure total={powerOf(opp.id)} className="mt-0.5 shrink-0" /> : null}
              </div>

              {/* Objective preview */}
              {!compact && opp.objective && (
                <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 flex gap-1.5">
                  <Target size={13} className="shrink-0 mt-0.5 text-muted-foreground/70" />
                  <span>{opp.objective}</span>
                </p>
              )}

              {/* Meta row */}
              <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground', compact ? 'mt-1.5' : 'mt-3')}>
                {opp.target_name && (
                  <span className="inline-flex items-center gap-1 truncate max-w-[160px]">
                    <Building2 size={12} className="shrink-0" />
                    <span className="truncate">{opp.target_name}</span>
                  </span>
                )}
                {opp.location && (
                  <span className="inline-flex items-center gap-1 truncate max-w-[140px]">
                    <MapPin size={12} className="shrink-0" />
                    <span className="truncate">{opp.location}</span>
                  </span>
                )}
              </div>

              {/* Footer: value + sector + probability */}
              <div className={cn('border-t border-border flex items-center justify-between gap-2', compact ? 'mt-2 pt-2' : 'mt-3 pt-3')}>
                {/*
                  ⚠ A BARE EM DASH AT A VALUE'S OWN WEIGHT READS AS A FAILED
                  RENDER (§12) — and `formatValue(null)` returns exactly that.
                  Measured 2026-10-26: 0 of 10 opportunities and 1 of 20
                  projects carry an `estimated_value`, so this slot was showing
                  "—" on essentially every card on the board. The most repeated
                  element on the flagship surface was a placeholder.

                  `ProjectCard` already names the absence in words; this is the
                  same treatment, so the two boards stop disagreeing about what
                  "no value" looks like.
                */}
                {pipelineValue(opp).amount != null ? (
                  <span
                    className="shrink-0 text-sm font-semibold tnum text-foreground"
                    title={pipelineValue(opp).hint}
                  >
                    {formatValue(pipelineValue(opp).amount)}
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] text-muted-foreground/70">No value set</span>
                )}
                {/*
                  ⚠ `min-w-0` + `truncate` + ROOM FOR THE HANDLE. `DragHandle`
                  is an absolutely-positioned SIBLING pinned to this card's
                  bottom-right (§12 requires the sibling, so the anchor still
                  covers the body), which means it floats OVER this row and
                  takes no space in it. A long sector — "Infrastructure" is the
                  commonest value on the board — ran straight under it on most
                  cards. `justify-between` on a flex row also refuses to shrink
                  a child without `min-w-0`, so truncation alone would not have
                  fired.
                */}
                <div
                  className={cn(
                    'flex min-w-0 items-center gap-2 text-xs text-muted-foreground',
                    draggable && 'pr-6'
                  )}
                >
                  {opp.sector && SECTOR_LABELS[opp.sector as ProjectSector] && (
                    <span className="truncate">{SECTOR_LABELS[opp.sector as ProjectSector]}</span>
                  )}
                  {opp.probability != null && (
                    <span className="tnum shrink-0 font-medium">{opp.probability}%</span>
                  )}
                </div>
              </div>

              {/* Next step / target date */}
              {!compact && (opp.next_step || opp.target_close_date) && (
                <div className="mt-2 text-[11px] text-muted-foreground/80 truncate">
                  {opp.next_step
                    ? `Next: ${opp.next_step}`
                    : `Target close ${formatDate(opp.target_close_date)}`}
                </div>
              )}
            </Link>

            {canDelete && onDeleted && (
              <RecordDeleteButton
                variant="card"
                target={{
                  endpoint: `/api/opportunities/${opp.id}`,
                  noun: 'opportunity',
                  name: opp.name,
                  description: 'This removes the opportunity and its attached documents.',
                }}
                onDeleted={() => onDeleted(opp.id)}
              />
            )}

            {/* A SIBLING of the Link, never a descendant (§12). */}
            {draggable && (
              <DragHandle
                dnd={dnd}
                id={opp.id}
                laneId={laneId}
                index={index}
                className="top-auto bottom-1 right-1 md:bottom-1.5 md:right-1.5"
              />
            )}
          </div>
  )
}
