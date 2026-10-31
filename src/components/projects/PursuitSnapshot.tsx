import { Timer, Percent, UserRound, Gavel, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Project, DealStage } from '@/lib/supabase/types'
import {
  formatValue, formatDate,
  bidDueLabel, bidDueColor, daysUntilDate,
  pwinBadge, weightedValue,
  bidDecision, BID_DECISION_LABELS, BID_DECISION_BADGE,
  STAGE_PIPELINE,
  winBand, winBandLabel, WIN_BAND_COLOR,
} from '@/lib/utils/constants'
import { pipelineValue } from '@/lib/records/pipeline-value'
import InlineField from './InlineField'

type ProjectWithCapture = Project & {
  bid_due_date?: string | null
  win_probability?: number | null
  bid_decision?: string | null
  capture_lead?: string | null
}

/**
 * What the pursuit looks like, and where most of it is changed.
 *
 * ⚠ EVERY FACT IN THIS RAIL IS NOW EDITABLE IN PLACE (Richard, 2026-10-30:
 * *"Make all those fields editable on a project by double clicking rather than
 * going to the 'edit' button"*). The rail is where these are READ, so it is
 * where they should be written; being sent to a separate form to change one
 * number, and then back, was the whole complaint.
 */
export default function PursuitSnapshot({ project }: { project: ProjectWithCapture }) {
  const stage = project.stage
  /*
    ⚠ THE OPEN PIPELINE, FROM THE VOCABULARY — not a list retyped here.
    This was `['pursuit', 'capture', 'bid']`, a hand-written enumeration beside
    the registry, which is the drift §12 names. A bid deadline is worth showing
    while the deal is live and is noise once it is Won or Lost.
  */
  const isOpen = (STAGE_PIPELINE as DealStage[]).includes(stage)
  const bidDue = project.bid_due_date ?? null
  const bidDueDays = daysUntilDate(bidDue)
  const winProb = project.win_probability ?? null
  const band = winBand(winProb)
  const decision = bidDecision(project.bid_decision)
  // Whichever figure this project actually has, named on screen below.
  const value = pipelineValue(project)
  const weighted = weightedValue(value.amount, winProb)

  // The offset clears the sticky record tab bar above it — see --record-bar-h
  // in globals.css. `lg:top-4` put this rail UNDER the bar as it scrolled.
  return (
    <aside className="lg:sticky lg:top-[calc(var(--record-bar-h)+0.75rem)] space-y-3">
      {/* Bid deadline hero */}
      {bidDue && isOpen && (
        <div
          className={cn(
            'rounded-lg border p-4 text-center',
            bidDueDays != null && bidDueDays <= 7
              ? 'border-critical-edge bg-critical-surface'
              : bidDueDays != null && bidDueDays <= 21
                ? 'border-caution-edge bg-caution-surface'
                : 'border-border bg-card'
          )}
        >
          <div className="flex items-center justify-center gap-1.5 label-caps text-muted-foreground">
            <Timer size={12} />
            Bid Submission
          </div>
          <p className={cn('text-2xl font-bold mt-1 tnum', bidDueColor(bidDue))}>
            {bidDueLabel(bidDue)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{formatDate(bidDue)}</p>
        </div>
      )}

      {/* Pursuit metrics */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-muted/30">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Pursuit Snapshot
          </span>
        </div>
        <div className="divide-y divide-border">
          {/* Bid decision */}
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5 shrink-0">
              <Gavel size={12} /> Decision
            </span>
            <InlineField
              projectId={project.id}
              field="bid_decision"
              value={project.bid_decision ?? null}
              labelled={false}
              className="min-w-0"
              display={
                <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', BID_DECISION_BADGE[decision])}>
                  {BID_DECISION_LABELS[decision]}
                </span>
              }
            />
          </div>

          {/*
            Win probability — LOW / MEDIUM / HIGH (Richard, 10-30).

            ⚠ THE BAND IS WHAT IS SHOWN AND WHAT IS PICKED; the column holds a
            percentage so `weightedValue()` below keeps working. §12 — never
            print a stored enum at a reader, and "20%" shown to somebody who
            chose "Low" is the same deception with more digits.
          */}
          <div className="px-4 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5 shrink-0">
                <Percent size={12} /> Win Probability
              </span>
              <InlineField
                projectId={project.id}
                field="win_probability"
                value={winProb}
                labelled={false}
                className="min-w-0"
                display={
                  <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset', pwinBadge(winProb))}>
                    {winBandLabel(winProb) ?? 'Not set'}
                  </span>
                }
              />
            </div>
            {band && (
              /*
                Three bands, three widths. The bar reinforces the word beside
                it rather than being a second quantity — it deliberately does
                NOT read the stored percentage, which would put the number back
                on screen through the back door.

                ⚠ The fill and the width are in DIFFERENT utility groups, so
                `cn()` composes them. Two `bg-*` classes would not: tailwind-
                merge silently deletes the earlier one (§12).
              */
              <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    WIN_BAND_COLOR[band],
                    band === 'high' ? 'w-full' : band === 'medium' ? 'w-1/2' : 'w-1/5'
                  )}
                />
              </div>
            )}
          </div>

          {/* Value + weighted */}
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <span className="text-xs text-muted-foreground shrink-0" title={value.hint}>
              {value.definition}
            </span>
            <InlineField
              projectId={project.id}
              field="estimated_value"
              value={project.estimated_value}
              labelled={false}
              className="min-w-0"
              display={<span className="text-sm font-bold tnum">{formatValue(value.amount)}</span>}
            />
          </div>
          {weighted > 0 && (
            <div className="flex items-center justify-between px-4 py-2.5">
              {/* ⚠ NOT EDITABLE, AND IT MUST NOT BE — it is the product of the
                  two fields above. A derived figure with a pencil beside it
                  invites somebody to "correct" it, and the correction would
                  vanish on the next render. */}
              <span className="text-xs text-muted-foreground">Weighted (P-win)</span>
              <span className="text-sm font-semibold tnum text-positive">{formatValue(weighted)}</span>
            </div>
          )}

          {/* Capture lead */}
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5 shrink-0">
              <UserRound size={12} /> Capture Lead
            </span>
            <InlineField
              projectId={project.id}
              field="capture_lead"
              value={project.capture_lead ?? null}
              labelled={false}
              className="min-w-0"
              display={
                <span className="text-xs font-medium text-foreground">
                  {project.capture_lead || <span className="text-muted-foreground">Unassigned</span>}
                </span>
              }
            />
          </div>
        </div>
      </div>

      {/*
        Key dates.

        ⚠ ALL FOUR ARE LISTED NOW, NOT ONLY THE ONES THAT ARE SET. This card
        filtered to dates that had a value, which is §12's rule about a surface
        hidden because it is empty being hidden exactly when somebody needs to
        fill it: the only way to set an NTP date was the edit form, which is
        the trip this whole change removes. An unset date says "Not set" in
        words rather than as a bare em dash, which reads as a failed render.
      */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-muted/30">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide inline-flex items-center gap-1.5">
            <CalendarDays size={12} /> Key Dates
          </span>
        </div>
        <div className="divide-y divide-border">
          {([
            { field: 'bid_due_date', label: 'Bid Due', value: bidDue, highlight: true },
            { field: 'award_date', label: 'Award', value: project.award_date, highlight: false },
            { field: 'ntp_date', label: 'NTP', value: project.ntp_date, highlight: false },
            {
              field: 'substantial_completion_date',
              label: 'Substantial Completion',
              value: project.substantial_completion_date,
              highlight: false,
            },
          ] as const).map((d) => (
            <div key={d.field} className="flex items-center justify-between gap-2 px-4 py-2">
              <span className="text-xs text-muted-foreground shrink-0">{d.label}</span>
              <InlineField
                projectId={project.id}
                field={d.field}
                value={d.value ?? null}
                labelled={false}
                className="min-w-0"
                display={
                  d.value ? (
                    <span className={cn('text-xs tnum', d.highlight ? cn('font-semibold', bidDueColor(d.value)) : 'text-foreground')}>
                      {formatDate(d.value)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not set</span>
                  )
                }
              />
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
