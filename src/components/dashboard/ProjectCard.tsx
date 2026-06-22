import Link from 'next/link'
import {
  CheckSquare, Clock, AlertTriangle, Layers, CalendarClock, Ban,
  Search, Target, Gavel, Award, Truck, HardHat, FlagTriangleRight,
  Timer, Percent, UserRound,
} from 'lucide-react'
import type { Project } from '@/lib/supabase/types'
import type { ProjectStage } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'
import { SECTOR_BADGE, SECTOR_SHORT } from '@/lib/utils/sectors'
import {
  STATUS_BADGE, STATUS_LABELS,
  bidDueLabel, bidDueColor, daysUntilDate, pwinBadge,
} from '@/lib/utils/constants'
import { STAGE_BADGE, STAGE_LABELS, STAGE_BORDER } from '@/lib/utils/stages'
import StageIndicator from './StageIndicator'

export interface ProjectDeadline {
  label: string
  date: string
  daysUntil: number
}

export interface ProjectCardCounts {
  actionCount: number
  waitingCount: number
  riskCount: number
  hasCriticalRisk: boolean
  /** Soonest upcoming (today or future) deadline across milestones + tasks */
  nextDeadline?: ProjectDeadline
  /** Count of items already past their due date */
  overdueCount?: number
  /** Count of open critical/blocker diligence items */
  blockingCount?: number
}

function deadlineLabel(d: ProjectDeadline): string {
  if (d.daysUntil === 0) return 'Due today'
  if (d.daysUntil === 1) return 'Due tomorrow'
  if (d.daysUntil <= 14) return `Due in ${d.daysUntil}d`
  return `Due ${new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

const STAGE_ICON: Record<ProjectStage, typeof Search> = {
  pursuit: Search,
  capture: Target,
  bid: Gavel,
  award: Award,
  mobilization: Truck,
  execution: HardHat,
  closeout: FlagTriangleRight,
}

function formatValue(value: number | null): string {
  if (value === null) return '—'
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

// Wrap the matched portion of a string in a <mark> so search hits stand out on
// the card. Case-insensitive; returns the plain string when there's no match.
function highlightText(text: string, query?: string): React.ReactNode {
  const q = query?.trim()
  if (!q) return text
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const out: React.ReactNode[] = []
  let from = 0
  let at = lower.indexOf(needle, from)
  let key = 0
  while (at !== -1) {
    if (at > from) out.push(text.slice(from, at))
    out.push(
      <mark key={key++} className="rounded bg-yellow-200/70 text-foreground px-0.5">
        {text.slice(at, at + needle.length)}
      </mark>
    )
    from = at + needle.length
    at = lower.indexOf(needle, from)
  }
  if (from < text.length) out.push(text.slice(from))
  return out
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

interface ProjectCardProps {
  project: Project
  counts?: ProjectCardCounts
  isProgram?: boolean
  parentName?: string
  /** Active search term — matched substrings in name/client/location are highlighted. */
  highlight?: string
  className?: string
  style?: React.CSSProperties
}

export default function ProjectCard({ project, counts, isProgram, parentName, highlight, className, style }: ProjectCardProps) {
  const status = project.status ?? 'active'
  const stage = (project.stage ?? 'pursuit') as ProjectStage
  const StageIcon = STAGE_ICON[stage]

  const bidDue = (project as { bid_due_date?: string | null }).bid_due_date ?? null
  const bidDueDays = daysUntilDate(bidDue)
  const winProb = (project as { win_probability?: number | null }).win_probability ?? null
  const captureLead = (project as { capture_lead?: string | null }).capture_lead ?? null
  // Only surface the submission deadline pre-award where it's actionable
  const showBidDue = bidDue && !['award', 'mobilization', 'execution', 'closeout'].includes(stage)

  return (
    <Link
      href={`/projects/${project.id}`}
      className={cn(
        'group block rounded-lg border border-border border-l-[3px] bg-card shadow-sm card-hover-glow',
        STAGE_BORDER[stage],
        className
      )}
      style={style}
    >
      <div className="p-4 sm:p-5 space-y-3">
        {/* Top row: stage badge (primary), sector badge, status badge */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
              STAGE_BADGE[stage]
            )}
          >
            <StageIcon size={11} className="shrink-0" />
            {STAGE_LABELS[stage]}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
              SECTOR_BADGE[project.sector]
            )}
          >
            {SECTOR_SHORT[project.sector]}
          </span>
          {status !== 'active' && (
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                STATUS_BADGE[status]
              )}
            >
              {STATUS_LABELS[status]}
            </span>
          )}
          {isProgram && (
            <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset bg-violet-50 text-violet-700 ring-violet-200">
              <Layers size={10} />
              Program
            </span>
          )}
        </div>

        {/* Project name + value */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-foreground leading-snug group-hover:text-primary transition-colors line-clamp-2 heading-tight">
              {highlightText(project.name, highlight)}
            </h3>
            {project.client_entity && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {highlightText(project.client_entity, highlight)}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="text-sm font-bold tabular-nums text-foreground">
              {formatValue(project.estimated_value)}
            </span>
            {winProb != null && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset tabular-nums',
                  pwinBadge(winProb)
                )}
                title={`Win probability ${winProb}%`}
              >
                <Percent size={9} className="shrink-0" />
                {winProb}% win
              </span>
            )}
          </div>
        </div>

        {/* Bid submission deadline — the date that matters most pre-award */}
        {showBidDue && (
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset',
              bidDueDays != null && bidDueDays < 0
                ? 'bg-red-50 ring-red-200'
                : bidDueDays != null && bidDueDays <= 7
                  ? 'bg-red-50 ring-red-200'
                  : bidDueDays != null && bidDueDays <= 21
                    ? 'bg-amber-50 ring-amber-200'
                    : 'bg-slate-50 ring-slate-200',
              bidDueColor(bidDue)
            )}
          >
            <Timer size={12} className="shrink-0" />
            Bid {bidDueLabel(bidDue)?.toLowerCase()}
          </div>
        )}

        {/* Stage progress bar */}
        <StageIndicator stage={stage} compact />

        {/* Action / waiting / risk counts — only when passed from dashboard */}
        {counts && (counts.actionCount > 0 || counts.waitingCount > 0 || counts.riskCount > 0) && (
          <div className="flex items-center gap-3">
            {counts.actionCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-slate-600">
                <CheckSquare size={11} className="shrink-0" />
                {counts.actionCount} action{counts.actionCount !== 1 ? 's' : ''}
              </span>
            )}
            {counts.waitingCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-amber-600">
                <Clock size={11} className="shrink-0" />
                {counts.waitingCount} waiting
              </span>
            )}
            {counts.riskCount > 0 && (
              <span className={cn(
                'flex items-center gap-1 text-xs font-medium',
                counts.hasCriticalRisk ? 'text-red-600' : 'text-amber-600'
              )}>
                <AlertTriangle size={11} className="shrink-0" />
                {counts.riskCount} risk{counts.riskCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {/* Deadline + blockers — "what's holding this up" at a glance */}
        {counts && (counts.nextDeadline || (counts.overdueCount ?? 0) > 0 || (counts.blockingCount ?? 0) > 0) && (
          <div className="flex items-center gap-3 flex-wrap">
            {(counts.overdueCount ?? 0) > 0 ? (
              <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                <CalendarClock size={11} className="shrink-0" />
                {counts.overdueCount} overdue
              </span>
            ) : counts.nextDeadline ? (
              <span className={cn(
                'flex items-center gap-1 text-xs font-medium',
                counts.nextDeadline.daysUntil <= 7 ? 'text-amber-600' : 'text-slate-600'
              )}>
                <CalendarClock size={11} className="shrink-0" />
                {deadlineLabel(counts.nextDeadline)}: {counts.nextDeadline.label}
              </span>
            ) : null}
            {(counts.blockingCount ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                <Ban size={11} className="shrink-0" />
                {counts.blockingCount} blocking
              </span>
            )}
          </div>
        )}

        {/* Footer: location + capture lead + last updated */}
        <div className="flex items-center justify-between pt-2 mt-1 border-t border-border/60">
          <span className="text-[11px] text-muted-foreground truncate max-w-[60%] flex items-center gap-1.5">
            <span className="truncate">
              {parentName
                ? <>Sub-project of {highlightText(parentName, highlight)}</>
                : highlightText(project.location ?? 'No location', highlight)}
            </span>
            {captureLead && (
              <span className="inline-flex items-center gap-0.5 text-muted-foreground/80 shrink-0">
                <UserRound size={10} className="shrink-0" />
                {captureLead}
              </span>
            )}
          </span>
          <span className="text-[11px] text-muted-foreground/70 shrink-0">
            {timeAgo(project.updated_at)}
          </span>
        </div>
      </div>
    </Link>
  )
}
