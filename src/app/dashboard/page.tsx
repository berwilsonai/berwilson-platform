import { Suspense } from 'react'
import Link from 'next/link'
import { FolderKanban } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata = { title: 'Dashboard — Ber Wilson Intelligence' }
import { type ProjectCardCounts } from '@/components/dashboard/ProjectCard'
import DashboardProjects from '@/components/dashboard/DashboardProjects'
import SortControls from '@/components/dashboard/SortControls'
import PortfolioBriefButton from '@/components/dashboard/PortfolioBriefButton'
import DailyBrief from '@/components/dashboard/DailyBrief'
import HealthPanel from '@/components/dashboard/HealthPanel'
import RiskOverview from '@/components/dashboard/RiskOverview'
import NeedsAttention from '@/components/dashboard/NeedsAttention'
import NowObjectives, { type NowObjectiveItem } from '@/components/dashboard/NowObjectives'
import VerticalRollup from '@/components/dashboard/VerticalRollup'
import ClosingSoon, { type ClosingSoonItem } from '@/components/dashboard/ClosingSoon'
import { weightedValue } from '@/lib/utils/constants'
import { fetchOpenTasks } from '@/lib/tasks/queries'
import { getViewer } from '@/lib/auth/viewer'
import { mailboxLooksBroken } from '@/lib/system-health'
import EmptyState from '@/components/shared/EmptyState'
import type { WaitingOnItem, RiskItem } from '@/types/domain'

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
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  // Greeting is rendered in the executives' timezone, not the server's.
  const denverHour = Number(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Denver' }))
  const greeting = denverHour < 12 ? 'Good morning' : denverHour < 17 ? 'Good afternoon' : 'Good evening'
  const dateLine = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Denver',
  })
  const viewer = await getViewer()
  const firstName = viewer?.teamMemberName?.split(' ')[0] ?? null

  // Parallel: projects + attention items
  const in90Days = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [
    { data: projectsRaw },
    overdueTasksAll,
    { data: reviewRaw, count: reviewCount },
    { data: overdueRaw },
    { data: ddRaw },
    { data: expiringCerts },
    { data: nowObjectivesRaw },
    { data: objectiveTaskRows },
    { data: investorFollowUpsRaw },
    { data: graphTokenRow },
  ] = await Promise.all([
    supabase.from('projects').select('*').eq('status', 'active'),
    fetchOpenTasks(supabase, { dueBefore: today }),
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
    // Steering board's Now column. Both selects fail quietly pre-migration
    // (objectives table / tasks.objective_id may not exist yet) → strip hidden.
    supabase
      .from('objectives')
      .select('id, title, target_date, health, owner:team_members(name, color)')
      .eq('status', 'active')
      .eq('bucket', 'now')
      .order('sort_order'),
    supabase
      .from('tasks')
      .select('objective_id')
      .eq('status', 'open')
      .not('objective_id', 'is', null),
    // Capital raise: investors whose next step is overdue (fails quietly pre-migration)
    supabase
      .from('investors')
      .select('id, name, stage, next_step, next_step_date')
      .not('stage', 'in', '(passed,dormant)')
      .lt('next_step_date', today)
      .order('next_step_date', { ascending: true }),
    // Mailbox health: a long-expired token means Graph refreshes are failing
    supabase
      .from('email_tokens')
      .select('email_address, expires_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const activeProjects = projectsRaw ?? []
  const projectIds = activeProjects.map((p) => p.id)

  // Fetch approved updates to compute per-project action counts
  let updatesRaw: Array<{ project_id: string | null; waiting_on: unknown; risks: unknown }> = []
  let openMilestones: Array<{ project_id: string; label: string; target_date: string | null }> = []
  let openTasks: Array<{ project_id: string | null; title: string; due_date: string | null }> = []
  if (projectIds.length > 0) {
    const [{ data: upd }, { data: ms }, { data: tk }] = await Promise.all([
      supabase
        .from('updates')
        .select('project_id, waiting_on, risks')
        .in('project_id', projectIds)
        .eq('review_state', 'approved'),
      supabase
        .from('milestones')
        .select('project_id, label, target_date')
        .in('project_id', projectIds)
        .is('completed_at', null)
        .not('target_date', 'is', null),
      supabase
        .from('tasks')
        .select('project_id, title, due_date')
        .in('project_id', projectIds)
        .eq('status', 'open'),
    ])
    updatesRaw = upd ?? []
    openMilestones = (ms ?? []) as typeof openMilestones
    openTasks = (tk ?? []) as typeof openTasks
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
    const waiting = safeArray<WaitingOnItem>(u.waiting_on)
    const risks = safeArray<RiskItem>(u.risks)
    countMap[pid].waitingCount += waiting.length
    countMap[pid].riskCount += risks.length
    if (risks.some((r) => r.severity === 'critical' || r.severity === 'blocker')) {
      countMap[pid].hasCriticalRisk = true
    }
  }

  // Per-project open task counts come from the team task system
  for (const t of openTasks) {
    const pid = t.project_id
    if (!pid) continue
    if (!countMap[pid]) {
      countMap[pid] = { actionCount: 0, waitingCount: 0, riskCount: 0, hasCriticalRisk: false }
    }
    countMap[pid].actionCount += 1
  }

  // ── Per-project deadlines + blockers (for "what's holding this up") ─────────
  const todayStart = new Date(today + 'T00:00:00').getTime()
  function daysUntil(dateStr: string): number {
    return Math.round((new Date(dateStr + 'T00:00:00').getTime() - todayStart) / 86_400_000)
  }
  function ensureEntry(pid: string): ProjectCardCounts {
    if (!countMap[pid]) {
      countMap[pid] = { actionCount: 0, waitingCount: 0, riskCount: 0, hasCriticalRisk: false }
    }
    return countMap[pid]
  }

  // Candidate deadlines: open milestones + open tasks with due dates
  const candidates: Record<string, Array<{ label: string; date: string; days: number }>> = {}
  function addCandidate(pid: string, label: string, dateStr: string | null) {
    if (!dateStr) return
    ;(candidates[pid] ??= []).push({ label, date: dateStr, days: daysUntil(dateStr) })
  }
  for (const m of openMilestones) addCandidate(m.project_id, m.label, m.target_date)
  for (const t of openTasks) {
    if (t.project_id && t.due_date) addCandidate(t.project_id, t.title, t.due_date)
  }
  for (const pid of Object.keys(candidates)) {
    const list = candidates[pid]
    const upcoming = list.filter(c => c.days >= 0).sort((a, b) => a.days - b.days)
    const entry = ensureEntry(pid)
    entry.overdueCount = list.filter(c => c.days < 0).length
    if (upcoming.length > 0) {
      entry.nextDeadline = { label: upcoming[0].label, date: upcoming[0].date, daysUntil: upcoming[0].days }
    }
  }
  // Open critical/blocker diligence items per project
  for (const dd of ddRaw ?? []) {
    if (dd.project_id) {
      const e = ensureEntry(dd.project_id)
      e.blockingCount = (e.blockingCount ?? 0) + 1
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
  const weightedPipelineValue = activeProjects.reduce(
    (sum, p) => sum + weightedValue(p.estimated_value, (p as { win_probability?: number | null }).win_probability ?? null),
    0
  )
  const pendingReview = reviewCount ?? 0
  const overdueCount = overdueRaw?.length ?? 0

  // Closing soon: pre-award pursuits with a bid deadline, soonest first
  const PRE_AWARD = new Set(['pursuit', 'capture', 'bid'])
  const closingSoon: ClosingSoonItem[] = activeProjects
    .filter((p) => {
      const due = (p as { bid_due_date?: string | null }).bid_due_date
      return due && PRE_AWARD.has(p.stage ?? 'pursuit')
    })
    .sort((a, b) => {
      const da = (a as { bid_due_date?: string | null }).bid_due_date ?? ''
      const db = (b as { bid_due_date?: string | null }).bid_due_date ?? ''
      return da.localeCompare(db)
    })
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      name: p.name,
      bid_due_date: (p as { bid_due_date?: string | null }).bid_due_date ?? null,
      estimated_value: p.estimated_value,
      win_probability: (p as { win_probability?: number | null }).win_probability ?? null,
    }))

  // Needs Attention data (cap display at 6 each). Critical system/compliance
  // items (mailbox, certs) render at the top of the same rail card.
  const overdueTasks = overdueTasksAll.filter((t) => t.due_date && t.due_date < today)
  const reviewItems = (reviewRaw ?? []).slice(0, 6) as ReviewWithProject[]
  const overdueItems = (overdueRaw ?? []).slice(0, 6) as MilestoneWithProject[]
  const ddItems = (ddRaw ?? []).slice(0, 6) as DdWithProject[]
  const mailboxAlert = mailboxLooksBroken(graphTokenRow?.expires_at)
    ? { email: graphTokenRow?.email_address ?? 'mailbox' }
    : null

  // Now objectives with open-task counts (from the tasks.objective_id tag)
  const objectiveTaskCounts: Record<string, number> = {}
  for (const row of (objectiveTaskRows ?? []) as Array<{ objective_id: string | null }>) {
    if (row.objective_id) {
      objectiveTaskCounts[row.objective_id] = (objectiveTaskCounts[row.objective_id] ?? 0) + 1
    }
  }
  const nowObjectives: NowObjectiveItem[] = (
    (nowObjectivesRaw ?? []) as Array<{
      id: string
      title: string
      target_date: string | null
      health: string
      owner: { name: string; color: string | null } | null
    }>
  ).map((o) => ({ ...o, openTasks: objectiveTaskCounts[o.id] ?? 0 }))

  return (
    <div className="space-y-6">

      {/* ── Greeting: the morning read opens like one ─────────────────────── */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight heading-tight">
          {greeting}{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{dateLine}</p>
      </div>

      {/* ── Steering board: Now objectives lead the morning read ─────────── */}
      {nowObjectives.length > 0 && <NowObjectives items={nowObjectives} />}

      {/* ── Portfolio health overview ─────────────────────────────────────── */}
      <div>
        <HealthPanel
          activeProjects={activeProjects.length}
          pipelineValue={pipelineValue}
          weightedPipelineValue={weightedPipelineValue}
          pendingReview={pendingReview}
          overdueCount={overdueCount}
          criticalDdCount={ddRaw?.length ?? 0}
          expiringCertsCount={expiringCerts?.length ?? 0}
        />
      </div>

      {/* ── Daily intelligence brief ────────────────────────────────────── */}
      {activeProjects.length > 0 && (
        <Suspense>
          <DailyBrief />
        </Suspense>
      )}

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-6">

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
            <DashboardProjects projects={sorted} counts={countMap} />
          )}
        </div>

        {/* Needs Attention — right on desktop, below cards on mobile */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0 space-y-3">
          {/* Closing soon — bid deadlines across the portfolio */}
          <ClosingSoon items={closingSoon} />

          {/* How each vertical is doing */}
          {activeProjects.length > 0 && (
            <VerticalRollup
              projects={activeProjects.map((p) => ({
                sector: p.sector,
                estimated_value: p.estimated_value,
                win_probability: (p as { win_probability?: number | null }).win_probability ?? null,
              }))}
            />
          )}

          {/* Risk overview */}
          <Suspense>
            <RiskOverview />
          </Suspense>

          <NeedsAttention
            reviewItems={reviewItems}
            overdueItems={overdueItems}
            ddItems={ddItems}
            reviewCount={reviewCount ?? 0}
            overdueTasks={overdueTasks}
            investorFollowUps={investorFollowUpsRaw ?? []}
            mailboxAlert={mailboxAlert}
            expiringCerts={expiringCerts ?? []}
          />
        </div>

      </div>
    </div>
  )
}
