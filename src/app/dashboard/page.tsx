import { Suspense } from 'react'
import Link from 'next/link'
import { FolderKanban } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata = { title: 'Dashboard — Ber Wilson Intelligence' }
import ProjectCard, { type ProjectCardCounts } from '@/components/dashboard/ProjectCard'
import SortControls from '@/components/dashboard/SortControls'
import PortfolioBriefButton from '@/components/dashboard/PortfolioBriefButton'
import DailyBrief from '@/components/dashboard/DailyBrief'
import AlertsBanner from '@/components/dashboard/AlertsBanner'
import HealthPanel from '@/components/dashboard/HealthPanel'
import RiskOverview from '@/components/dashboard/RiskOverview'
import NeedsAttention from '@/components/dashboard/NeedsAttention'
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
  const in90Days = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [
    { data: projectsRaw },
    { data: reviewRaw, count: reviewCount },
    { data: overdueRaw },
    { data: ddRaw },
    { data: expiringCerts },
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
    supabase
      .from('certifications')
      .select('id, name, expiration_date, issuing_body')
      .eq('is_active', true)
      .lte('expiration_date', in90Days)
      .order('expiration_date', { ascending: true }),
  ])

  const activeProjects = projectsRaw ?? []
  const projectIds = activeProjects.map((p) => p.id)

  // Fetch approved updates to compute per-project action counts
  let updatesRaw: Array<{ project_id: string | null; action_items: unknown; waiting_on: unknown; risks: unknown }> = []
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
    if (!pid) continue
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
  // Build alerts data for the banner
  const alerts: Array<{ type: 'critical' | 'overdue' | 'review'; text: string; href: string }> = []
  for (const dd of ddItems) {
    alerts.push({
      type: 'critical',
      text: `[${dd.severity.toUpperCase()}] ${dd.project?.name}: ${dd.item.slice(0, 80)}`,
      href: `/projects/${dd.project_id}/diligence`,
    })
  }
  for (const m of overdueItems) {
    if (m.target_date) {
      alerts.push({
        type: 'overdue',
        text: `Overdue: ${m.label} (${m.project?.name}) — ${daysOverdue(m.target_date)}d past due`,
        href: `/projects/${m.project_id}/milestones`,
      })
    }
  }
  for (const cert of expiringCerts ?? []) {
    const days = cert.expiration_date
      ? Math.ceil((new Date(cert.expiration_date).getTime() - Date.now()) / 86_400_000)
      : null
    const isExpired = days !== null && days < 0
    alerts.push({
      type: isExpired ? 'critical' : 'overdue',
      text: isExpired
        ? `Cert EXPIRED: ${cert.name}${cert.issuing_body ? ` (${cert.issuing_body})` : ''} — renew now`
        : `Cert expiring in ${days}d: ${cert.name}${cert.issuing_body ? ` (${cert.issuing_body})` : ''}`,
      href: '/company',
    })
  }

  return (
    <div className="space-y-6">

      {/* ── Portfolio health overview ─────────────────────────────────────── */}
      <div className="animate-fade-in-up">
        <HealthPanel
          activeProjects={activeProjects.length}
          pipelineValue={pipelineValue}
          pendingReview={pendingReview}
          overdueCount={overdueCount}
          criticalDdCount={ddRaw?.length ?? 0}
          expiringCertsCount={expiringCerts?.length ?? 0}
        />
      </div>

      {/* ── Alerts banner — critical items across portfolio ──────────────── */}
      {alerts.length > 0 && (
        <div className="animate-fade-in-up" style={{ animationDelay: '50ms' }}>
          <AlertsBanner alerts={alerts} />
        </div>
      )}

      {/* ── Daily intelligence brief ────────────────────────────────────── */}
      {activeProjects.length > 0 && (
        <div className="animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <Suspense>
            <DailyBrief />
          </Suspense>
        </div>
      )}

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-6 animate-fade-in-up" style={{ animationDelay: '150ms' }}>

        {/* Cards grid — left on desktop, first on mobile */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {activeProjects.length} active project{activeProjects.length !== 1 ? 's' : ''}
              </span>
              {activeProjects.length > 0 && <PortfolioBriefButton />}
            </div>
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
              {sorted.map((project, i) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  counts={countMap[project.id]}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${200 + i * 50}ms` }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Needs Attention — right on desktop, below cards on mobile */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0 space-y-3">
          {/* Risk overview */}
          <Suspense>
            <RiskOverview />
          </Suspense>

          <NeedsAttention
            reviewItems={reviewItems}
            overdueItems={overdueItems}
            ddItems={ddItems}
            reviewCount={reviewCount ?? 0}
          />
        </div>

      </div>
    </div>
  )
}
