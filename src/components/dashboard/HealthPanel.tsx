import Link from 'next/link'
import { CheckCircle2, Landmark, TrendingUp, FolderKanban, BellRing } from 'lucide-react'
import { cn } from '@/lib/utils'

interface HealthPanelProps {
  activeProjects: number
  pipelineValue: number
  weightedPipelineValue: number
  pendingReview: number
  overdueCount: number
  criticalDdCount: number
  expiringCertsCount: number
}

function formatValue(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

/**
 * Executive KPI band: the state of the portfolio in four calm numbers.
 * Real figures only — no synthetic score. Detail and navigation live in the
 * alerts banner and Needs Attention rail below.
 */
export default function HealthPanel({
  activeProjects,
  pipelineValue,
  weightedPipelineValue,
  pendingReview,
  overdueCount,
  criticalDdCount,
  expiringCertsCount,
}: HealthPanelProps) {
  const totalAlerts = criticalDdCount + overdueCount + pendingReview + expiringCertsCount

  const breakdown = [
    { count: criticalDdCount, label: 'critical', className: 'text-red-600 dark:text-red-400' },
    { count: overdueCount, label: 'overdue', className: 'text-orange-600 dark:text-orange-400' },
    { count: pendingReview, label: 'in review', className: 'text-amber-600 dark:text-amber-400' },
    { count: expiringCertsCount, label: 'cert expiry', className: 'text-yellow-600 dark:text-yellow-500' },
  ].filter((b) => b.count > 0)

  return (
    <div className="rounded-xl border border-border bg-card elev-1 px-5 py-4 sm:px-6">
      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
        <div className="min-w-0 flex items-start gap-3">
          <span className="mt-0.5 size-9 shrink-0 rounded-lg bg-primary/10 text-primary dark:bg-primary/20 flex items-center justify-center">
            <Landmark size={17} />
          </span>
          <div className="min-w-0">
            <dt className="label-caps text-muted-foreground">
              Pipeline Value
            </dt>
            <dd className="mt-1 text-3xl font-semibold text-foreground tnum heading-tight">
              {pipelineValue > 0 ? formatValue(pipelineValue) : '—'}
            </dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">Total across active projects</dd>
          </div>
        </div>

        <div className="min-w-0 flex items-start gap-3">
          <span className="mt-0.5 size-9 shrink-0 rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300 flex items-center justify-center">
            <TrendingUp size={17} />
          </span>
          <div className="min-w-0">
            <dt className="label-caps text-muted-foreground">
              Weighted Pipeline
            </dt>
            <dd className="mt-1 text-3xl font-semibold text-foreground tnum heading-tight">
              {weightedPipelineValue > 0 ? formatValue(weightedPipelineValue) : '—'}
            </dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">Adjusted for win probability</dd>
          </div>
        </div>

        <div className="min-w-0 flex items-start gap-3">
          <span className="mt-0.5 size-9 shrink-0 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 flex items-center justify-center">
            <FolderKanban size={17} />
          </span>
          <div className="min-w-0">
            <dt className="label-caps text-muted-foreground">
              Active Projects
            </dt>
            <dd className="mt-1 text-3xl font-semibold text-foreground tnum heading-tight">
              {activeProjects}
            </dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">
              <Link href="/projects" className="hover:text-foreground transition-colors">
                View pipeline →
              </Link>
            </dd>
          </div>
        </div>

        <div className="min-w-0 flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 size-9 shrink-0 rounded-lg flex items-center justify-center',
              totalAlerts > 0
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                : 'bg-muted text-muted-foreground'
            )}
          >
            <BellRing size={17} />
          </span>
          <div className="min-w-0">
            <dt className="label-caps text-muted-foreground">
              Needs Attention
            </dt>
            <dd
              className={cn(
                'mt-1 text-3xl font-semibold tnum heading-tight',
                totalAlerts > 0 ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {totalAlerts}
            </dd>
            <dd className="mt-0.5 text-xs">
              {totalAlerts === 0 ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 size={12} /> All clear
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {breakdown.map((b, i) => (
                    <span key={b.label}>
                      {i > 0 && ' · '}
                      <span className={cn('font-medium tnum', b.className)}>{b.count}</span> {b.label}
                    </span>
                  ))}
                </span>
              )}
            </dd>
          </div>
        </div>
      </dl>
    </div>
  )
}
