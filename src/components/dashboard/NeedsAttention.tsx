import Link from 'next/link'
import { AlertTriangle, CalendarClock, ClipboardCheck, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SECTOR_BADGE, SECTOR_SHORT } from '@/lib/utils/sectors'

type ReviewWithProject = {
  id: string
  reason: string
  source_table: string
  confidence: number | null
  created_at: string | null
  project_id: string | null
  project: { id: string; name: string; sector: string } | null
}

type MilestoneWithProject = {
  id: string
  label: string
  target_date: string | null
  stage: string
  project_id: string
  project: { id: string; name: string } | null
}

type DdWithProject = {
  id: string
  item: string
  severity: string
  category: string
  project_id: string
  project: { id: string; name: string } | null
}

function daysOverdue(targetDate: string): number {
  return Math.floor((Date.now() - new Date(targetDate).getTime()) / 86_400_000)
}

interface NeedsAttentionProps {
  reviewItems: ReviewWithProject[]
  overdueItems: MilestoneWithProject[]
  ddItems: DdWithProject[]
  reviewCount: number
}

export default function NeedsAttention({ reviewItems, overdueItems, ddItems, reviewCount }: NeedsAttentionProps) {
  const hasAttention = reviewItems.length > 0 || overdueItems.length > 0 || ddItems.length > 0

  return (
    <div className="rounded-lg glass-panel shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <AlertTriangle size={14} className={cn(hasAttention ? 'text-amber-500' : 'text-muted-foreground')} />
        <h2 className="text-sm font-semibold text-foreground heading-tight">Needs Attention</h2>
        {hasAttention && (
          <span className="ml-auto text-xs font-medium tabular-nums bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">
            {reviewItems.length + overdueItems.length + ddItems.length}
          </span>
        )}
      </div>

      {!hasAttention ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">All clear</p>
          <p className="text-xs text-muted-foreground/70 mt-1">No items require immediate attention.</p>
        </div>
      ) : (
        <div className="p-3 space-y-3">

          {/* Review queue items */}
          {reviewItems.length > 0 && (
            <div className="rounded-md bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="size-1.5 rounded-full bg-amber-400 shrink-0" />
                <ClipboardCheck size={12} className="text-muted-foreground shrink-0" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Review Queue
                </span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{reviewItems.length}</span>
              </div>
              <div className="space-y-1">
                {reviewItems.map((item) => (
                  <Link
                    key={item.id}
                    href="/review"
                    className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {item.project?.name ?? 'Unknown project'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                        {item.reason.replace(/_/g, ' ')}
                        {item.confidence != null && (
                          <span className="ml-1 text-amber-600">
                            {Math.round(item.confidence * 100)}%
                          </span>
                        )}
                      </p>
                    </div>
                    {item.project?.sector && (
                      <span className={cn(
                        'shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                        SECTOR_BADGE[item.project.sector as keyof typeof SECTOR_BADGE]
                      )}>
                        {SECTOR_SHORT[item.project.sector as keyof typeof SECTOR_SHORT]}
                      </span>
                    )}
                  </Link>
                ))}
                {reviewCount > 6 && (
                  <Link
                    href="/review"
                    className="block px-2 py-1 text-xs text-blue-600 hover:underline"
                  >
                    +{reviewCount - 6} more →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Overdue milestones */}
          {overdueItems.length > 0 && (
            <div className="rounded-md bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="size-1.5 rounded-full bg-red-400 shrink-0" />
                <CalendarClock size={12} className="text-red-500 shrink-0" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Overdue Milestones
                </span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{overdueItems.length}</span>
              </div>
              <div className="space-y-1">
                {overdueItems.map((m) => (
                  <Link
                    key={m.id}
                    href={`/projects/${m.project_id}/milestones`}
                    className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{m.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {m.project?.name ?? 'Unknown project'}
                      </p>
                    </div>
                    {m.target_date && (
                      <span className="shrink-0 text-xs font-medium text-red-600 tabular-nums">
                        {daysOverdue(m.target_date)}d
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Critical / blocker DD items */}
          {ddItems.length > 0 && (
            <div className="rounded-md bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="size-1.5 rounded-full bg-orange-400 shrink-0" />
                <TrendingUp size={12} className="text-red-500 shrink-0" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Due Diligence
                </span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{ddItems.length}</span>
              </div>
              <div className="space-y-1">
                {ddItems.map((dd) => (
                  <Link
                    key={dd.id}
                    href={`/projects/${dd.project_id}/diligence`}
                    className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground line-clamp-2">{dd.item}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {dd.project?.name ?? 'Unknown project'}
                      </p>
                    </div>
                    <span className={cn(
                      'shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                      dd.severity === 'blocker'
                        ? 'bg-red-100 text-red-700 ring-red-200'
                        : 'bg-orange-50 text-orange-700 ring-orange-200'
                    )}>
                      {dd.severity}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
