/**
 * GET /api/cron/daily-brief
 *
 * Cron job that generates a portfolio daily brief and stores it.
 * Designed to run every morning. Does NOT send email — just stores the brief
 * in stored_briefs table for viewing at /briefs.
 *
 * When email sending is ready, add the send step after storage.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callGemini } from '@/lib/ai/gemini'
import { fetchOpenTasks, formatTaskLine } from '@/lib/tasks/queries'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

const PROACTIVE_BRIEF_PROMPT = `You are a chief of staff for two construction executives managing a multi-billion dollar portfolio.
Generate a morning intelligence brief. Be direct, urgent, and actionable.

Structure:
## Good Morning — [Date]

### Steering Check
(One or two sentences: how today's urgent items line up against the company's Now objectives. Only include when objectives are provided.)

### Needs Your Attention Today
(Items requiring immediate action or decision — max 5, ranked by urgency)

### This Week's Pressure Points
(Approaching deadlines, stale blockers, relationships going cold)

### Portfolio Pulse
(2-3 sentence health check across all projects)

### Decisions Pending Follow-Through
(Decisions made but not yet executed — flag these for accountability)

Rules:
- Lead with the most urgent item. No preamble.
- Use specific names, dates, and dollar amounts — not vague summaries.
- If something is X days overdue, say exactly how many days.
- If a relationship is going cold, name the person and suggest an action.
- When company objectives are provided, connect urgent items to the objective they serve where the link is clear — and call out any Now objective with no visible movement.
- Keep it under 600 words. Executives scan, they don't read essays.`

export async function GET(request: NextRequest) {
  // Verify cron secret (fail closed if the secret is not configured)
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const now = new Date()
  const today = now.toISOString().split('T')[0]

  // Check if we already generated today's brief
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase as any)
    .from('stored_briefs')
    .select('id')
    .eq('brief_type', 'portfolio')
    .gte('created_at', `${today}T00:00:00.000Z`)
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({ message: 'Brief already generated today', brief_id: existing[0].id })
  }

  // Gather all the intelligence data
  const [
    openTasks,
    { data: projects },
    { data: updates },
    { data: milestones },
    { data: ddItems },
    { data: complianceItems },
    { data: dependencies },
    { data: objectives },
  ] = await Promise.all([
    fetchOpenTasks(supabase, { limit: 300 }),
    supabase.from('projects').select('id, name, sector, stage, estimated_value, location').eq('status', 'active'),
    supabase
      .from('updates')
      .select('id, project_id, summary, waiting_on, risks, decisions, created_at, projects(name)')
      .eq('review_state', 'approved')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('milestones')
      .select('id, label, stage, target_date, completed_at, project_id, projects(name)')
      .is('completed_at', null)
      .lte('target_date', new Date(now.getTime() + 14 * 86_400_000).toISOString().split('T')[0])
      .order('target_date'),
    supabase
      .from('dd_items')
      .select('id, item, severity, status, project_id, created_at, projects(name)')
      .neq('status', 'resolved')
      .in('severity', ['critical', 'blocker']),
    supabase
      .from('compliance_items')
      .select('id, framework, requirement, status, due_date, project_id, projects(name)')
      .not('status', 'in', '("compliant","waived")')
      .lte('due_date', new Date(now.getTime() + 30 * 86_400_000).toISOString().split('T')[0]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('project_dependencies')
      .select('id, description, severity, upstream_project_id, downstream_project_id')
      .eq('status', 'active'),
    // Steering board — fails quietly (null) pre-migration
    supabase
      .from('objectives')
      .select('title, bucket, target_date, owner:team_members(name)')
      .eq('status', 'active')
      .in('bucket', ['now', 'soon'])
      .order('sort_order'),
  ])

  const projectMap: Record<string, string> = {}
  for (const p of projects ?? []) projectMap[p.id] = p.name

  const pName = (u: { projects: unknown }) => (u.projects as { name: string } | null)?.name ?? 'Unknown'

  // Build context for the brief
  type JsonItem = Record<string, unknown>
  const staleWaiting: string[] = []
  const staleDecisions: string[] = []

  // Overdue + due-soon tasks come from the real task system
  const overdueActions = openTasks
    .filter(t => t.due_date && t.due_date < today)
    .map(t => formatTaskLine(t, now))
  const dueSoon = openTasks
    .filter(t => t.due_date && t.due_date >= today && new Date(t.due_date).getTime() <= now.getTime() + 7 * 86_400_000)
    .map(t => formatTaskLine(t, now))

  for (const u of updates ?? []) {
    for (const w of (u.waiting_on ?? []) as JsonItem[]) {
      const since = w.since ? new Date(w.since as string) : new Date(u.created_at ?? '')
      const days = Math.floor((now.getTime() - since.getTime()) / 86_400_000)
      if (days >= 14) {
        staleWaiting.push(`- ${w.text} — waiting on ${w.party ?? 'unknown'} for ${days}d (${pName(u)})`)
      }
    }
    for (const d of (u.decisions ?? []) as JsonItem[]) {
      if (!d.text) continue
      const decDate = d.date ? new Date(d.date as string) : new Date(u.created_at ?? '')
      const days = Math.floor((now.getTime() - decDate.getTime()) / 86_400_000)
      if (days >= 14) {
        staleDecisions.push(`- "${d.text}" (${pName(u)}, decided ${days}d ago by ${d.made_by ?? 'unknown'})`)
      }
    }
  }

  const approachingMs = (milestones ?? []).map(m => {
    const days = Math.floor((new Date(m.target_date!).getTime() - now.getTime()) / 86_400_000)
    const label = days < 0 ? `${Math.abs(days)}d OVERDUE` : `${days}d away`
    return `- ${m.label} — ${pName(m)} (${label}, ${m.stage} gate)`
  })

  const criticalDd = (ddItems ?? []).map(dd => {
    const days = Math.floor((now.getTime() - new Date(dd.created_at ?? '').getTime()) / 86_400_000)
    return `- ${dd.item} — ${pName(dd)} (${dd.severity}, open ${days}d)`
  })

  const expiringComp = (complianceItems ?? []).map(c => {
    const days = Math.floor((new Date(c.due_date!).getTime() - now.getTime()) / 86_400_000)
    return `- ${c.framework}: ${c.requirement} — ${pName(c)} (${days < 0 ? 'OVERDUE' : `${days}d to deadline`})`
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const depRisks = (dependencies ?? []).map((d: any) => {
    const up = projectMap[d.upstream_project_id] ?? 'Unknown'
    const down = projectMap[d.downstream_project_id] ?? 'Unknown'
    return `- ${d.description ?? `${up} → ${down}`} (${d.severity})`
  })

  const projectSummaries = (projects ?? []).map(p =>
    `- ${p.name}: ${p.stage} stage, $${((p.estimated_value ?? 0) / 1_000_000).toFixed(1)}M, ${p.sector}, ${p.location ?? 'no location'}`
  )

  const objectiveLines = ((objectives ?? []) as Array<{
    title: string
    bucket: string
    target_date: string | null
    owner: { name: string } | null
  }>)
    .sort((a, b) => (a.bucket === b.bucket ? 0 : a.bucket === 'now' ? -1 : 1))
    .map(o =>
      `- [${o.bucket.toUpperCase()}] ${o.title}${o.owner ? ` — ${o.owner.name}` : ''}${o.target_date ? ` (target ${o.target_date})` : ''}`,
    )

  const userMessage = `Today is ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.

COMPANY OBJECTIVES (steering board — Now/Soon):
${objectiveLines.join('\n') || '(none set)'}

ACTIVE PROJECTS:
${projectSummaries.join('\n') || '(none)'}

OVERDUE TASKS (${overdueActions.length}):
${overdueActions.slice(0, 10).join('\n') || '(none)'}

TASKS DUE IN THE NEXT 7 DAYS (${dueSoon.length}):
${dueSoon.slice(0, 10).join('\n') || '(none)'}

STALE WAITING-ON ITEMS (${staleWaiting.length}, >14 days):
${staleWaiting.slice(0, 10).join('\n') || '(none)'}

APPROACHING MILESTONES (next 14 days):
${approachingMs.join('\n') || '(none)'}

CRITICAL/BLOCKER DD ITEMS (${criticalDd.length}):
${criticalDd.join('\n') || '(none)'}

EXPIRING COMPLIANCE (next 30 days):
${expiringComp.join('\n') || '(none)'}

DECISIONS PENDING FOLLOW-THROUGH (${staleDecisions.length}, >14 days):
${staleDecisions.slice(0, 8).join('\n') || '(none)'}

CROSS-PROJECT DEPENDENCY RISKS:
${depRisks.join('\n') || '(none)'}`

  const result = await callGemini<string>({
    task: 'synthesize',
    systemPrompt: PROACTIVE_BRIEF_PROMPT,
    userMessage,
    userId: SYSTEM_USER_ID,
    promptVersion: 'proactive-brief-v1',
    maxTokens: 3000,
    jsonMode: false,
  })

  const brief = result.data as string

  // Store the brief
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: stored, error: storeError } = await (supabase as any)
    .from('stored_briefs')
    .insert({
      brief_type: 'portfolio',
      title: `Daily Brief — ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      content: brief,
      model_used: result.model,
      latency_ms: result.latencyMs,
      metadata: {
        overdue_actions: overdueActions.length,
        stale_waiting: staleWaiting.length,
        stale_decisions: staleDecisions.length,
        critical_dd: criticalDd.length,
      },
    })
    .select('id')
    .single()

  if (storeError) {
    console.error('[daily-brief] Failed to store brief:', storeError.message)
  }

  return NextResponse.json({
    success: true,
    brief_id: stored?.id ?? null,
    model_used: result.model,
    latency_ms: result.latencyMs,
  })
}
