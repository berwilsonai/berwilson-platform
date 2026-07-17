import { Timer, Percent, UserRound, Gavel, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Project, ProjectStage } from '@/lib/supabase/types'
import {
  formatValue, formatDate,
  bidDueLabel, bidDueColor, daysUntilDate,
  pwinBadge, weightedValue,
  bidDecision, BID_DECISION_LABELS, BID_DECISION_BADGE,
} from '@/lib/utils/constants'

type ProjectWithCapture = Project & {
  bid_due_date?: string | null
  win_probability?: number | null
  bid_decision?: string | null
  capture_lead?: string | null
}

const PRE_AWARD: ProjectStage[] = ['pursuit', 'capture', 'bid']

export default function PursuitSnapshot({ project }: { project: ProjectWithCapture }) {
  const stage = (project.stage ?? 'pursuit') as ProjectStage
  const isPreAward = PRE_AWARD.includes(stage)
  const bidDue = project.bid_due_date ?? null
  const bidDueDays = daysUntilDate(bidDue)
  const winProb = project.win_probability ?? null
  const decision = bidDecision(project.bid_decision)
  const weighted = weightedValue(project.estimated_value, winProb)

  const dates = [
    { label: 'Bid Due', value: bidDue, highlight: true },
    { label: 'Award', value: project.award_date, highlight: false },
    { label: 'NTP', value: project.ntp_date, highlight: false },
    { label: 'Substantial Completion', value: project.substantial_completion_date, highlight: false },
  ].filter((d) => d.value)

  return (
    <aside className="lg:sticky lg:top-4 space-y-3">
      {/* Bid deadline hero */}
      {bidDue && isPreAward && (
        <div
          className={cn(
            'rounded-lg border p-4 text-center',
            bidDueDays != null && bidDueDays <= 7
              ? 'border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40'
              : bidDueDays != null && bidDueDays <= 21
                ? 'border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40'
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
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Gavel size={12} /> Decision
            </span>
            <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', BID_DECISION_BADGE[decision])}>
              {BID_DECISION_LABELS[decision]}
            </span>
          </div>

          {/* Win probability */}
          <div className="px-4 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                <Percent size={12} /> Win Probability
              </span>
              <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset tnum', pwinBadge(winProb))}>
                {winProb != null ? `${winProb}%` : '—'}
              </span>
            </div>
            {winProb != null && (
              <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    winProb >= 60 ? 'bg-emerald-500' : winProb >= 35 ? 'bg-amber-500' : 'bg-red-500'
                  )}
                  style={{ width: `${winProb}%` }}
                />
              </div>
            )}
          </div>

          {/* Value + weighted */}
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-xs text-muted-foreground">Est. Value</span>
            <span className="text-sm font-bold tnum">{formatValue(project.estimated_value)}</span>
          </div>
          {weighted > 0 && (
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-xs text-muted-foreground">Weighted (P-win)</span>
              <span className="text-sm font-semibold tnum text-emerald-600 dark:text-emerald-400">{formatValue(weighted)}</span>
            </div>
          )}

          {/* Capture lead */}
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <UserRound size={12} /> Capture Lead
            </span>
            <span className="text-xs font-medium text-foreground">
              {project.capture_lead || <span className="text-muted-foreground">Unassigned</span>}
            </span>
          </div>
        </div>
      </div>

      {/* Key dates */}
      {dates.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide inline-flex items-center gap-1.5">
              <CalendarDays size={12} /> Key Dates
            </span>
          </div>
          <div className="divide-y divide-border">
            {dates.map((d) => (
              <div key={d.label} className="flex items-center justify-between px-4 py-2">
                <span className="text-xs text-muted-foreground">{d.label}</span>
                <span className={cn('text-xs tnum', d.highlight ? cn('font-semibold', bidDueColor(d.value)) : 'text-foreground')}>
                  {formatDate(d.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
