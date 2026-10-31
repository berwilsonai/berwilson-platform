import { Suspense } from 'react'
import Link from 'next/link'
import { FolderKanban } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeAttention } from '@/lib/attention'

export const metadata = { title: 'Dashboard — Ber Wilson Intelligence' }
import { type ProjectCardCounts } from '@/components/dashboard/ProjectCard'
import DashboardProjects from '@/components/dashboard/DashboardProjects'
import SortControls from '@/components/dashboard/SortControls'
import PortfolioBriefButton from '@/components/dashboard/PortfolioBriefButton'
import DailyBrief from '@/components/dashboard/DailyBrief'
import HealthPanel from '@/components/dashboard/HealthPanel'
import { daysBetween, deltaFrom, priorSnapshot } from '@/lib/records/snapshot'
import StageMix from '@/components/dashboard/StageMix'
import AttentionRail, { type AttentionRailItem } from '@/components/dashboard/AttentionRail'
import AskBar from '@/components/dashboard/AskBar'
import NowObjectives, { type NowObjectiveItem } from '@/components/dashboard/NowObjectives'
import JustIn from '@/components/dashboard/JustIn'
import Commitments from '@/components/dashboard/Commitments'
import { loadOpenCommitments } from '@/lib/commitments/load'
import { weightedValue } from '@/lib/utils/constants'
import {
  coverageNote,
  leafRecords,
  pipelineValue,
  portfolioTotal,
} from '@/lib/records/pipeline-value'
import { readPhaseRows } from '@/lib/records/power-read'
import { fetchOpenTasks } from '@/lib/tasks/queries'
import { getViewer } from '@/lib/auth/viewer'
import { dropHidden } from '@/lib/security/confidential'
import { viewerHiddenProjectIds } from '@/lib/security/request'
import { mailboxLooksBroken } from '@/lib/system-health'
import { sweepDb } from '@/lib/email-sweep/db'
import { countDecideItems } from '@/lib/decide/count'
import { readJustIn } from '@/lib/records/just-in'
import EmptyState from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/ui/page-header'
import type { WaitingOnItem, RiskItem } from '@/types/domain'

// ─── types for joined queries ────────────────────────────────────────────────

/*
  ⚠ THREE JOINED ROW TYPES WERE DELETED HERE ON 2026-10-29, with the queries
  that filled them. `ReviewWithProject`, `MilestoneWithProject` and
  `DdWithProject` existed to feed `NeedsAttention` — this page's own second
  attention engine — and the only numbers still wanted from those tables are
  counts, which need no shape. See AttentionRail for why there is one engine.
*/

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
  // Best-effort: loadOpenCommitments never throws, so a missing table or a
  // failed read costs this panel and nothing else on the page.
  const commitments = await loadOpenCommitments()

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
    { data: overdueRaw },
    { data: ddRaw },
    { data: expiringCerts },
    { data: nowObjectivesRaw },
    { data: objectiveTaskRows },
    { data: mailboxSyncRow },
    attention,
  ] = await Promise.all([
    supabase.from('projects').select('*').eq('status', 'active'),
    fetchOpenTasks(supabase, { dueBefore: today }),
    // ⚠ A COUNT AND A PER-PROJECT TALLY, NOT A LIST ANY MORE. The KPI band
    // prints "overdue milestones" and ProjectCard prints each deal's own
    // figure; the rail reads the engine. `project_id` is all either needs.
    supabase
      .from('milestones')
      .select('id, project_id')
      .lt('target_date', today)
      .is('completed_at', null),
    // Same: the KPI tile's count and ProjectCard's `blockingCount`.
    supabase
      .from('dd_items')
      .select('id, project_id')
      .in('severity', ['critical', 'blocker'])
      .in('status', ['open', 'in_progress']),
    // The KPI tile's count only. The expiring certs THEMSELVES are now an
    // attention kind (`expiring_certification`, 10-29), so the rail renders
    // them from the engine like everything else.
    supabase
      .from('certifications')
      .select('id')
      .eq('is_active', true)
      .lte('expiration_date', in90Days),
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
    /*
      ⚠ THREE FETCHES WERE DELETED HERE ON 2026-10-29 — investor follow-ups,
      Dino payments and INBOUND LEADS. All three were read only by
      `NeedsAttention`, and `computeAttention()` already scores all three as
      kinds of its own.

      The leads one was a live bug, not a duplicate. On 10-21 leads were taken
      out of `ATTENTION_KINDS` with a note saying the middle option — keeping
      only the bids closing inside N days — is WORSE than either extreme,
      because it puts a third threshold on rows /leads and /decide already
      rank. Three days later this block was still selecting
      `bid_due_date <= today + 14` with a `fit_recommendation` filter. A ⚠
      comment in one file does not stop the sibling drifting (§12).
    */
    // Mailbox health: a failed sweep means mail is no longer reaching the CRM.
    // Goes through sweepDb because mailbox_sync postdates the generated types.
    sweepDb()
      .from('mailbox_sync')
      .select('mailbox, state, last_error')
      .eq('state', 'failed')
      .limit(1)
      .maybeSingle(),
    /*
      ── THE ONE ATTENTION ENGINE ──────────────────────────────────────────
      Nine queries, scored 0-100, confidential projects and human dismissals
      both applied inside it at the choke point — so this page cannot forget
      either, which is exactly what the hand-rolled rail did forget.

      It is a function call rather than a query because that is the point: the
      rail, /attention, the sidebar badge, Ber AI's `get_attention_items` and
      Pepper's morning note now all read ONE producer.

      Fails quiet. `computeAttention()` throwing used to cost nothing because
      nothing on this page called it; now it would cost the whole morning read,
      so it degrades to an empty rail the same way `loadOpenCommitments` and
      `readJustIn` already do.
    */
    computeAttention().catch(() => ({
      items: [] as AttentionRailItem[],
      summary: { total: 0 },
      dismissed: [],
    })),
  ])

  // ── Protected projects ──────────────────────────────────────────────────────
  //
  // The dashboard is the one surface where EVERY number is a sum, so a
  // protected project is withheld from all of them rather than redacted in
  // place. Filtering activeProjects here cascades: projectIds below drives the
  // updates, milestones and tasks reads, so none of them can reach a hidden
  // project either. The four lists fetched independently above are filtered
  // beside their own consumers.
  //
  // The withholding is REPORTED, not silent — an unlabelled count is not a
  // coverage signal (§12), and a portfolio value quietly missing a project is
  // worse than one that says so.
  const hidden = await viewerHiddenProjectIds()
  // What arrived since Friday and is on no record yet. Viewer-aware: the band
  // takes the same hidden set every other figure on this page is filtered by.
  const justIn = await readJustIn({ hidden }).catch(() => [])
  const activeProjects = dropHidden(projectsRaw ?? [], (p) => p.id, hidden)
  const protectedCount = (projectsRaw ?? []).length - activeProjects.length
  const projectIds = activeProjects.map((p) => p.id)
  const visibleProject = (row: { project_id?: string | null }) =>
    !row.project_id || !hidden.has(row.project_id)

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
  for (const dd of (ddRaw ?? []).filter(visibleProject)) {
    if (dd.project_id) {
      const e = ensureEntry(dd.project_id)
      e.blockingCount = (e.blockingCount ?? 0) + 1
    }
  }

  // Sort projects
  const sorted = [...activeProjects].sort((a, b) => {
    if (sort === 'value') {
      // An unpriced deal sorts last rather than as $0 — `?? -1`, so it falls
      // below a real zero if anybody ever types one.
      return (pipelineValue(b).amount ?? -1) - (pipelineValue(a).amount ?? -1)
    }
    if (sort === 'actions') {
      return (countMap[b.id]?.actionCount ?? 0) - (countMap[a.id]?.actionCount ?? 0)
    }
    // default: updated
    return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
  })

  // Stats
  //
  // ⚠ THE TOTAL NAMES HOW MUCH OF THE PORTFOLIO IT COVERS. `estimated_value`
  // was one unlabelled column holding $57.5B of plainly different quantities,
  // and the lesson survived the calculator that replaced it: a sum over 1 of 30
  // priced deals must say so rather than presenting itself as the portfolio.
  //
  // ⚠ AND IT COUNTS EACH DEAL ONCE. This summed every active project flat, so a
  // program carrying its own figure alongside sub-projects carrying theirs was
  // counted twice — latent only because `parent_project_id` was used by 0 of 14
  // rows. `portfolioTotal` keeps the leaves: a deal's value lives on leaves,
  // and a program's value is what the work inside it adds up to.
  // The ramp schedules for the cards. Read over `activeProjects`, which is
  // already past the access and confidential filters above.
  const phaseRows = await readPhaseRows(activeProjects.map((p) => p.id))

  const pipeline = portfolioTotal(activeProjects)
  const pipelineValueTotal = pipeline.amount
  // The same leaf set, or the weighted figure disagrees with the one above it.
  const pipelineLeaves = leafRecords(activeProjects)
  const weightedPipelineValue = pipelineLeaves.reduce(
    (sum, p) =>
      sum +
      weightedValue(
        pipelineValue(p).amount,
        (p as { win_probability?: number | null }).win_probability ?? null
      ),
    0
  )
  // The KPI counts what the Decide queue holds, not the review table alone —
  // the same source the sidebar badge uses, so the two agree. The full
  // review_queue rows above still feed the Needs Attention panel below.
  /*
    ⚠ THE DELTA IS COMPUTED HERE, FROM THE SAME VARIABLES THE TILES PRINT, and
    not inside the tile. The prior figure comes out of `portfolio_snapshots`;
    the current one is the number already on screen — so the two sides of the
    comparison can never be derived differently, which is the whole failure
    mode §12 names for a number checked against itself.

    ⚠ AND IT FAILS QUIET. No snapshot yet (the table starts empty, and for the
    first week after this ships that is the normal state), a missed cron, or a
    read that errors all give `null`, and every tile then renders exactly as it
    did before. A delta nobody can compute must never become a 0%.
  */
  const prior = await priorSnapshot().catch(() => null)
  const snapshotDeltas = prior
    ? (() => {
        const age = daysBetween(prior.captured_on, today)
        return {
          pipelineValue: deltaFrom(pipelineValueTotal, prior.pipeline_value, age),
          weightedPipelineValue: deltaFrom(
            weightedPipelineValue,
            prior.weighted_pipeline_value,
            age
          ),
          activeProjects: deltaFrom(activeProjects.length, prior.active_projects, age),
        }
      })()
    : undefined

  const pendingReview = await countDecideItems()
  const overdueMilestones = (overdueRaw ?? []).filter(visibleProject)
  const overdueCount = overdueMilestones.length

  const overdueTasks = overdueTasksAll
    .filter(visibleProject)
    .filter((t) => t.due_date && t.due_date < today)
  const visibleDd = (ddRaw ?? []).filter(visibleProject)

  /*
    ── The rail's rows ──────────────────────────────────────────────────────
    Sliced HERE and counted from the engine's own summary, which are two
    different numbers arriving separately on purpose: the old card summed the
    lengths of three already-sliced lists, so its badge capped its own
    contributions at six and under-reported itself by construction (§12 — a
    badge cap inventing a third quantity).

    Six rows, because the rail is a sticky column beside the project cards and
    a seventh pushes the "see all" link out of sight — which is the failure the
    old card had, where there was no way in the product to reach item seven.
  */
  const attentionItems: AttentionRailItem[] = attention.items.slice(0, 6).map((i) => ({
    id: i.id,
    category: i.category,
    urgency: i.urgency,
    title: i.title,
    detail: i.detail,
    project_id: i.project_id,
    project_name: i.project_name,
  }))
  const syncRow = mailboxSyncRow as { mailbox: string; state: string; last_error: string | null } | null
  // Carry the recorded reason onto the card. During an outage "why" is the
  // whole question, and making the reader open another page to find it is how
  // a red banner gets ignored.
  const mailboxAlert = mailboxLooksBroken(syncRow?.state)
    ? { email: syncRow?.mailbox ?? 'mailbox', reason: syncRow?.last_error ?? null }
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

  // Latest stored portfolio brief — written by the Monday cron or a manual
  // generate on any device. Served as the panel's initial content so the
  // weekly brief is actually visible on every device, not just the one that
  // generated it.
  const { data: storedBriefRows } = await supabase
    .from('stored_briefs')
    .select('content, created_at')
    .eq('brief_type', 'portfolio')
    .order('created_at', { ascending: false })
    .limit(1)
  const storedBrief = storedBriefRows?.[0]
    ? { content: storedBriefRows[0].content, createdAt: storedBriefRows[0].created_at }
    : null

  return (
    <div className="space-y-6">

      {/* ── Greeting: the morning read opens like one ─────────────────────── */}
      <PageHeader
        eyebrow={dateLine}
        title={`${greeting}${firstName ? `, ${firstName}` : ''}`}
        className="mb-0"
      />

      {/*
        ── ASK BER AI, FIRST ────────────────────────────────────────────────
        Measured 10-29: `agent_conversations` holds 25 rows from the last 30
        days and nearly every one is "what do we know about X" or "write me a
        document about X" — about one a day, and the single most-used thing in
        the platform. It was reachable by ⌘J and by a sidebar row in the FOURTH
        group, under two operating companies, with five triage destinations
        above it. This is the same dock, in the reader's path.
      */}
      <AskBar />

      {/*
        Say what is missing. Every figure below is a sum, and a sum quietly
        short of a project is worse than one that names the gap — §12: an
        unlabelled count is not a coverage signal.
      */}
      {protectedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {protectedCount} protected project{protectedCount === 1 ? ' is' : 's are'} not included
          in anything on this page.{' '}
          <Link href="/projects" className="underline underline-offset-2 hover:text-foreground">
            Open it from Projects
          </Link>
          .
        </p>
      )}

      {/*
        ── The numbers first ─────────────────────────────────────────────────
        ⚠ THE KPI BAND MOVED ABOVE "JUST IN" AND THE OBJECTIVES ON 2026-10-27.
        It used to sit third, below two tall panels, so on a 1512×950 screen the
        state of the portfolio was BELOW THE FOLD on the page whose whole job is
        to show it. Every dashboard in the brief — Domo most explicitly — opens
        on its measures and puts the narrative under them.

        This does NOT overturn the 09-24 argument for Just-In-above-Objectives;
        that was about which of those two comes first, and they are still in
        that order directly beneath.
      */}
      <HealthPanel
        activeProjects={activeProjects.length}
        pipelineValue={pipelineValueTotal}
        pipelineNote={coverageNote(pipeline)}
        unpricedCount={pipeline.unpriced}
        rolledUpCount={pipeline.rolledUp}
        weightedPipelineValue={weightedPipelineValue}
        deltas={snapshotDeltas}
        pendingReview={pendingReview}
        overdueCount={overdueCount}
        overdueTaskCount={overdueTasks.length}
        criticalDdCount={visibleDd.length}
        expiringCertsCount={expiringCerts?.length ?? 0}
      />

      {/* ── Where the pipeline actually sits ─────────────────────────────── */}
      <StageMix records={activeProjects} />

      {/*
        ── Just in ───────────────────────────────────────────────────────────
        Above the objectives deliberately. The objectives are what we SAID
        matters, which does not change between mornings; this is what changed
        overnight, and a recorded call attached to nothing is the single item on
        this page with the shortest useful life.
      */}
      <JustIn items={justIn} />

      {/* ── Steering board: Now objectives lead the morning read ─────────── */}
      {nowObjectives.length > 0 && <NowObjectives items={nowObjectives} />}

      {/* ── Intelligence brief (latest stored portfolio brief) ──────────── */}
      {activeProjects.length > 0 && (
        <Suspense>
          <DailyBrief initial={storedBrief} />
        </Suspense>
      )}

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">

        {/* Cards grid — left on desktop, first on mobile */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {activeProjects.length} active project{activeProjects.length !== 1 ? 's' : ''}
            </span>
            {activeProjects.length > 0 && <PortfolioBriefButton />}
          </div>

          {activeProjects.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="No active projects"
              description="Add your first project to start tracking your pipeline."
              action={
                <Link
                  href="/projects/new"
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary elev-1 text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  New Project
                </Link>
              }
            />
          ) : (
            <DashboardProjects
              projects={sorted}
              counts={countMap}
              phases={phaseRows}
              sortControl={
                <Suspense>
                  <SortControls current={sort} />
                </Suspense>
              }
            />
          )}
        </div>

        {/* Needs Attention — right on desktop, below cards on mobile */}
        {/*
          ── THE RAIL ─────────────────────────────────────────────────────
          ⚠ STICKY, AND WITH ITS OWN SCROLL. Measured by the UI audit and
          confirmed: the rail began ~460px down the page — a void beside the
          KPI tiles and the pipeline chart — and then ran roughly 1,500px PAST
          the bottom of the main column, so the two halves of the morning read
          shared almost no vertical space. Pinned to the top of the content
          area it sits beside the thing it comments on, and capping its height
          with its own overflow keeps it from setting the page's length.
          ⚠ `lg:` only: on a phone the rail is just the next section down, and
          a sticky element inside a single column pins over the content.
        */}
        <div className="w-full shrink-0 space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)] lg:w-72 lg:self-start lg:overflow-y-auto lg:pr-1 xl:w-80">
          {/* ⚠ THREE PANELS WERE REMOVED FROM THIS RAIL 2026-09-24, each for a
              measured reason rather than for tidiness:

              ClosingSoon — rendered unconditionally while **0 of 15 projects
              have ever carried a bid_due_date**, so it was permanently empty
              dead space at the top of the morning read.

              VerticalRollup — a four-row breakdown of fourteen projects, for
              two executives who know the portfolio by heart.

              RiskOverview — a synthetic 0-100 score. The same argument retired
              the synthetic health score from HealthPanel on 2026-07-03: show
              real numbers, not a composite nobody can act on.

              The components are deleted, not hidden. If bid dates ever start
              landing on projects, the deadline belongs on the Projects list and
              in the weekly brief, which already read that column. */}

          {/* Obligations read out of correspondence. Above the attention rail
              because a promise with a date on it outranks a queue count, and
              these exist nowhere else in the platform. */}
          {commitments.items.length > 0 && (
            <Commitments items={commitments.items} counts={commitments.counts} />
          )}

          <AttentionRail
            items={attentionItems}
            total={attention.summary.total}
            mailboxAlert={mailboxAlert}
          />
        </div>

      </div>
    </div>
  )
}
