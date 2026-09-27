import Link from 'next/link'
import { CheckCircle2, Landmark, TrendingUp, FolderKanban, BellRing } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatValue } from '@/lib/utils/constants'

interface HealthPanelProps {
  activeProjects: number
  pipelineValue: number
  weightedPipelineValue: number
  /** The Decide queue. Stated separately, NEVER added to the total. */
  pendingReview: number
  /** Overdue milestones. */
  overdueCount: number
  /** Overdue open tasks. */
  overdueTaskCount: number
  criticalDdCount: number
  expiringCertsCount: number
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
  overdueTaskCount,
  criticalDdCount,
  expiringCertsCount,
}: HealthPanelProps) {
  /*
    TWO QUANTITIES, NEVER ONE NUMBER.

    "Needs attention" is work falling through the cracks — an overdue task, a
    critical diligence item, a certification about to lapse. The Decide queue
    is a backlog of inbound things waiting on a call, and it is an order of
    magnitude larger (197 against 1 when this was written). Summing them made
    the tile read 197 while the sidebar's own Dashboard badge read 1, so the
    two numbers on one screen contradicted each other and neither could be
    trusted. The queue now gets its own line and its own link.
  */
  // The same four things countAttention() counts for the sidebar badge.
  const totalAlerts = criticalDdCount + overdueCount + overdueTaskCount + expiringCertsCount

  const breakdown = [
    { count: criticalDdCount, label: 'critical', plural: 'critical', className: 'text-red-600 dark:text-red-400' },
    { count: overdueCount, label: 'overdue milestone', plural: 'overdue milestones', className: 'text-orange-600 dark:text-orange-400' },
    { count: overdueTaskCount, label: 'overdue task', plural: 'overdue tasks', className: 'text-orange-600 dark:text-orange-400' },
    { count: expiringCertsCount, label: 'cert expiry', plural: 'cert expiries', className: 'text-yellow-600 dark:text-yellow-500' },
  ].filter((b) => b.count > 0)

  // A KPI tile with no value is not a KPI tile. Weighted pipeline is unset
  // until someone puts a win probability on a project; until then it is an
  // instruction, and an instruction does not belong at 3xl beside real money.
  const showWeighted = weightedPipelineValue > 0

  return (
    <div className="rounded-xl border border-border bg-card elev-1 px-5 py-4 sm:px-6">
      <dl className={cn('grid grid-cols-2 gap-x-8 gap-y-5', showWeighted ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
        <div className="min-w-0 flex items-start gap-3">
          <span className="mt-0.5 size-9 shrink-0 rounded-lg bg-primary/10 text-primary dark:bg-primary/20 flex items-center justify-center">
            <Landmark size={17} />
          </span>
          <div className="min-w-0">
            <dt className="label-caps text-muted-foreground">
              Pipeline Value
            </dt>
            <dd className="mt-1 text-3xl font-semibold text-foreground tnum heading-tight">
              {pipelineValue > 0 ? formatValue(pipelineValue) : 'Not set'}
            </dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">Total across active projects</dd>
          </div>
        </div>

        {showWeighted && (
          <div className="min-w-0 flex items-start gap-3">
            <span className="mt-0.5 size-9 shrink-0 rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300 flex items-center justify-center">
              <TrendingUp size={17} />
            </span>
            <div className="min-w-0">
              <dt className="label-caps text-muted-foreground">
                Weighted Pipeline
              </dt>
              <dd className="mt-1 text-3xl font-semibold text-foreground tnum heading-tight">
                {formatValue(weightedPipelineValue)}
              </dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">Adjusted for win probability</dd>
            </div>
          </div>
        )}

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
                      <span className={cn('font-medium tnum', b.className)}>{b.count}</span>{' '}
                      {b.count === 1 ? b.label : b.plural}
                    </span>
                  ))}
                </span>
              )}
            </dd>
            {/* The Decide backlog, stated as itself and linked to its own page —
                never added into the number above. */}
            {pendingReview > 0 && (
              <dd className="mt-0.5 text-xs">
                <Link
                  href="/decide"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="font-medium tnum text-amber-600 dark:text-amber-400">{pendingReview}</span>
                  {' '}waiting to decide →
                </Link>
              </dd>
            )}
          </div>
        </div>
      </dl>
    </div>
  )
}
