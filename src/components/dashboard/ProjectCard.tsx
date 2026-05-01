import Link from 'next/link'
import { CheckSquare, Clock, AlertTriangle } from 'lucide-react'
import type { Project } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'
import { SECTOR_BADGE, SECTOR_SHORT } from '@/lib/utils/sectors'
import StageIndicator from './StageIndicator'

export interface ProjectCardCounts {
  actionCount: number
  waitingCount: number
  riskCount: number
  hasCriticalRisk: boolean
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  on_hold: 'bg-amber-50 text-amber-700 ring-amber-200',
  won: 'bg-blue-50 text-blue-700 ring-blue-200',
  lost: 'bg-red-50 text-red-600 ring-red-200',
  closed: 'bg-slate-100 text-slate-500 ring-slate-200',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  won: 'Won',
  lost: 'Lost',
  closed: 'Closed',
}

function formatValue(value: number | null): string {
  if (value === null) return '—'
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
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
}

export default function ProjectCard({ project, counts }: ProjectCardProps) {
  const status = project.status ?? 'active'
  const stage = project.stage ?? 'pursuit'

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group block rounded-lg border border-border bg-card hover:border-slate-300 hover:shadow-sm transition-all"
    >
      <div className="p-4 space-y-3">
        {/* Top row: sector badge, status badge, value */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
              SECTOR_BADGE[project.sector]
            )}
          >
            {SECTOR_SHORT[project.sector]}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
              STATUS_STYLES[status]
            )}
          >
            {STATUS_LABELS[status]}
          </span>
          <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">
            {formatValue(project.estimated_value)}
          </span>
        </div>

        {/* Project name */}
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-snug group-hover:text-blue-600 transition-colors line-clamp-2">
            {project.name}
          </h3>
          {project.client_entity && (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {project.client_entity}
            </p>
          )}
        </div>

        {/* Stage progress bar */}
        <StageIndicator stage={stage} compact />

        {/* Action / waiting / risk counts — only when passed from dashboard */}
        {counts && (counts.actionCount > 0 || counts.waitingCount > 0 || counts.riskCount > 0) && (
          <div className="flex items-center gap-3">
            {counts.actionCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-slate-600">
                <CheckSquare size={11} className="shrink-0" />
                {counts.actionCount} action{counts.actionCount !== 1 ? 's' : ''}
              </span>
            )}
            {counts.waitingCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-amber-600">
                <Clock size={11} className="shrink-0" />
                {counts.waitingCount} waiting
              </span>
            )}
            {counts.riskCount > 0 && (
              <span className={cn(
                'flex items-center gap-1 text-[11px] font-medium',
                counts.hasCriticalRisk ? 'text-red-600' : 'text-amber-600'
              )}>
                <AlertTriangle size={11} className="shrink-0" />
                {counts.riskCount} risk{counts.riskCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {/* Footer: location + last updated */}
        <div className="flex items-center justify-between pt-1 border-t border-border">
          <span className="text-[11px] text-muted-foreground truncate max-w-[60%]">
            {project.location ?? 'No location'}
          </span>
          <span className="text-[11px] text-muted-foreground shrink-0">
            {timeAgo(project.updated_at)}
          </span>
        </div>
      </div>
    </Link>
  )
}
