import { Suspense } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, ClipboardCheck, FolderKanban, TrendingUp } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Dashboard — Ber Wilson Intelligence' }
import { SECTOR_SHORT, SECTOR_BADGE } from '@/lib/utils/sectors'
import ProjectCard, { type ProjectCardCounts } from '@/components/dashboard/ProjectCard'
import SortControls from '@/components/dashboard/SortControls'
import EmptyState from '@/components/shared/EmptyState'
import type { ActionItem, WaitingOnItem, RiskItem } from '@/types/domain'

// ─── helpers ────────────────────────────────────────────────────────────────

function formatValue(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

function daysOverdue(targetDate: string): number {
  return Math.floor((Date.now() - new Date(targetDate).getTime()) / 86_400_000)
}

// ─── types for joined queries ────────────────────────────────────────────────

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

// ─── page ────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{ sort?: string }>
}

const VALID_SORTS = ['updated', 'value', 'actions'] as const
type SortKey = typeof VALID_SORTS[number]

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams
  const sort: SortKey = VALID_SORTS.includes(params.sort as SortKey)
    ? (params.sort as SortKey)
    : 'updated'

  const supabase = createAdminClient()
  const today = new Date().toISOString().split('T')[0]

  // Parallel: projects + attention items
  const [
    { data: projectsRaw },
    { data: reviewRaw, count: reviewCount },
    { data: overdueRaw },
    { data: ddRaw },
  ] = await Promise.all([
    supabase.from('projects').select('*').eq('status', 'active'),
    supabase
      .from('review_queue')
      .select('id, reason, source_table, confidence, created_at, project_id, project:projects(id, name, sector)', { count: 'exact' })
      .is('resolved_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('milestones')
      .select('id, label, target_date, stage, project_id, project:projects(id, name)')
      .lt('target_date', today)
      .is('completed_at', null)
      .order('target_date', { ascending: true }),
    supabase
      .from('dd_items')
      .select('id, item, severity, category, project_id, project:projects(id, name)')
      .in('severity', ['critical', 'blocker'])
      .in('status', ['open', 'in_progress'])
      .order('severity', { ascending: false }),
  ])

  const activeProjects = projectsRaw ?? []
  const projectIds = activeProjects.map((p) => p.id)

  // Fetch approved updates to compute per-project action counts
  let updatesRaw: Array<{ project_id: string; action_items: unknown; waiting_on: unknown; risks: unknown }> = []
  if (projectIds.length > 0) {
    const { data } = await supabase
      .from('updates')
      .select('project_id, action_items, waiting_on, risks')
      .in('project_id', projectIds)
      .eq('review_state', 'approved')
    updatesRaw = data ?? []
  }

  // Safely parse a jsonb field that might come back as a JS array or a JSON string
  function safeArray<T>(val: unknown): T[] {
    if (Array.isArray(val)) return val as T[]
    if (typeof val === 'string') {
      try { const p = JSON.parse(val); return Array.isArray(p) ? p : [] } catch { return [] }
    }
    return []
  }

  // Compute per-project counts
  const countMap: Record<string, ProjectCardCounts> = {}
  for (const u of updatesRaw) {
    const pid = u.project_id
    if (!countMap[pid]) {
      countMap[pid] = { actionCount: 0, waitingCount: 0, riskCount: 0, hasCriticalRisk: false }
    }
    const actions = safeArray<ActionItem>(u.action_items)
    const waiting = safeArray<WaitingOnItem>(u.waiting_on)
    const risks = safeArray<RiskItem>(u.risks)
    countMap[pid].actionCount += actions.filter((a) => !a.completed).length
    countMap[pid].waitingCount += waiting.length
    countMap[pid].riskCount += risks.length
    if (risks.some((r) => r.severity === 'critical' || r.severity === 'blocker')) {
      countMap[pid].hasCriticalRisk = true
    }
  }

  // Sort projects
  const sorted = [...activeProjects].sort((a, b) => {
    if (sort === 'value') return (b.estimated_value ?? 0) - (a.estimated_value ?? 0)
    if (sort === 'actions') {
      return (countMap[b.id]?.actionCount ?? 0) - (countMap[a.id]?.actionCount ?? 0)
    }
    // default: updated
    return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
  })

  // Stats
  const pipelineValue = activeProjects.reduce((sum, p) => sum + (p.estimated_value ?? 0), 0)
  const pendingReview = reviewCount ?? 0
  const overdueCount = overdueRaw?.length ?? 0

  // Needs Attention data (cap display at 6 each)
  const reviewItems = (reviewRaw ?? []).slice(0, 6) as ReviewWithProject[]
  const overdueItems = (overdueRaw ?? []).slice(0, 6) as MilestoneWithProject[]
  const ddItems = (ddRaw ?? []).slice(0, 6) as DdWithProject[]
  const hasAttention = reviewItems.length > 0 || overdueItems.length > 0 || ddItems.length > 0

  return (
    <div className="space-y-5">

      {/* ── Summary stats ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Active Projects</p>
          <p className="text-2xl font-bold mt-1 text-foreground">{activeProjects.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Pipeline Value</p>
          <p className="text-2xl font-bold mt-1 text-foreground">
            {pipelineValue > 0 ? formatValue(pipelineValue) : '—'}
          </p>
        </div>
        <div className={cn(
          'rounded-lg border p-4',
          pendingReview > 0 ? 'border-amber-200 bg-amber-50' : 'border-border bg-card'
        )}>
          <p className={cn('text-xs', pendingReview > 0 ? 'text-amber-700' : 'text-muted-foreground')}>
            In Review
          </p>
          <p className={cn('text-2xl font-bold mt-1', pendingReview > 0 ? 'text-amber-800' : 'text-foreground')}>
            {pendingReview}
          </p>
        </div>
        <div className={cn(
          'rounded-lg border p-4',
          overdueCount > 0 ? 'border-red-200 bg-red-50' : 'border-border bg-card'
        )}>
          <p className={cn('text-xs', overdueCount > 0 ? 'text-red-700' : 'text-muted-foreground')}>
            Overdue Milestones
          </p>
          <p className={cn('text-2xl font-bold mt-1', overdueCount > 0 ? 'text-red-700' : 'text-foreground')}>
            {overdueCount}
          </p>
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-5">

        {/* Cards grid — left on desktop, first on mobile */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {activeProjects.length} active project{activeProjects.length !== 1 ? 's' : ''}
            </span>
            <Suspense>
              <SortControls current={sort} />
            </Suspense>
          </div>

          {activeProjects.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="No active projects"
              description="Add your first project to start tracking your pipeline."
              action={
                <Link
                  href="/projects/new"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                >
                  New Project
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {sorted.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  counts={countMap[project.id]}
                />
              ))}
            </div>
          )}
        </div>

        {/* Needs Attention — right on desktop, below cards on mobile */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0">
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <AlertTriangle size={14} className={cn(hasAttention ? 'text-amber-500' : 'text-muted-foreground')} />
              <h2 className="text-sm font-semibold text-foreground">Needs Attention</h2>
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
              <div className="divide-y divide-border">

                {/* Review queue items */}
                {reviewItems.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 px-4 py-2 bg-muted/40">
                      <ClipboardCheck size={11} className="text-muted-foreground shrink-0" />
                      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                        Review Queue
                      </span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{reviewItems.length}</span>
                    </div>
                    {reviewItems.map((item) => (
                      <Link
                        key={item.id}
                        href="/review"
                        className="flex items-start gap-2 px-4 py-2.5 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">
                            {item.project?.name ?? 'Unknown project'}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">
                            {item.reason.replace(/_/g, ' ')}
                            {item.confidence != null && (
                              <span className="ml-1 text-amber-600">
                                {Math.round(item.confidence * 100)}% confidence
                              </span>
                            )}
                          </p>
                        </div>
                        {item.project?.sector && (
                          <span className={cn(
                            'shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
                            SECTOR_BADGE[item.project.sector as keyof typeof SECTOR_BADGE]
                          )}>
                            {SECTOR_SHORT[item.project.sector as keyof typeof SECTOR_SHORT]}
                          </span>
                        )}
                      </Link>
                    ))}
                    {(reviewCount ?? 0) > 6 && (
                      <Link
                        href="/review"
                        className="block px-4 py-2 text-[11px] text-blue-600 hover:underline"
                      >
                        +{(reviewCount ?? 0) - 6} more in review queue →
                      </Link>
                    )}
                  </div>
                )}

                {/* Overdue milestones */}
                {overdueItems.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 px-4 py-2 bg-muted/40">
                      <CalendarClock size={11} className="text-red-500 shrink-0" />
                      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                        Overdue Milestones
                      </span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{overdueItems.length}</span>
                    </div>
                    {overdueItems.map((m) => (
                      <Link
                        key={m.id}
                        href={`/projects/${m.project_id}/milestones`}
                        className="flex items-start gap-2 px-4 py-2.5 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{m.label}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            {m.project?.name ?? 'Unknown project'}
                          </p>
                        </div>
                        {m.target_date && (
                          <span className="shrink-0 text-[11px] font-medium text-red-600 tabular-nums">
                            {daysOverdue(m.target_date)}d
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                )}

                {/* Critical / blocker DD items */}
                {ddItems.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 px-4 py-2 bg-muted/40">
                      <TrendingUp size={11} className="text-red-500 shrink-0" />
                      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                        Due Diligence
                      </span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{ddItems.length}</span>
                    </div>
                    {ddItems.map((dd) => (
                      <Link
                        key={dd.id}
                        href={`/projects/${dd.project_id}/diligence`}
                        className="flex items-start gap-2 px-4 py-2.5 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground line-clamp-2">{dd.item}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            {dd.project?.name ?? 'Unknown project'}
                          </p>
                        </div>
                        <span className={cn(
                          'shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
                          dd.severity === 'blocker'
                            ? 'bg-red-100 text-red-700 ring-red-200'
                            : 'bg-orange-50 text-orange-700 ring-orange-200'
                        )}>
                          {dd.severity}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}

              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
