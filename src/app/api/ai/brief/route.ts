/**
 * POST /api/ai/brief
 *
 * Generates an executive brief.
 * Body: { project_id?: string }
 *   - With project_id: single project brief
 *   - Without project_id: portfolio-level brief across all active projects
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callGemini } from '@/lib/ai/gemini'
import { checkRateLimit } from '@/lib/rate-limit'
import { fetchOpenTasks } from '@/lib/tasks/queries'
import {
  PROJECT_BRIEF_SYSTEM_PROMPT,
  PORTFOLIO_BRIEF_SYSTEM_PROMPT,
  BRIEF_PROMPT_VERSION,
  buildProjectBriefMessage,
  buildPortfolioBriefMessage,
} from '@/lib/ai/prompts/brief'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = checkRateLimit(`brief:${user.id}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
    )
  }

  let body: { project_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (body.project_id) {
    return generateProjectBrief(admin, user.id, body.project_id)
  }
  return generatePortfolioBrief(admin, user.id)
}

// ---------------------------------------------------------------------------
// Single project brief
// ---------------------------------------------------------------------------

async function generateProjectBrief(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  projectId: string
) {
  // Fetch project + all related data in parallel
  const [
    { data: project },
    openTasks,
    { data: updates },
    { data: milestones },
    { data: ddItems },
    { data: financing },
    { data: compliance },
    { data: players },
  ] = await Promise.all([
    admin.from('projects').select('*').eq('id', projectId).single(),
    fetchOpenTasks(admin, { projectId, limit: 50 }),
    admin.from('updates')
      .select('summary, waiting_on, risks, decisions, created_at')
      .eq('project_id', projectId)
      .eq('review_state', 'approved')
      .order('created_at', { ascending: false })
      .limit(10),
    admin.from('milestones')
      .select('label, stage, target_date, completed_at')
      .eq('project_id', projectId)
      .order('sort_order'),
    admin.from('dd_items')
      .select('category, item, status, severity, notes')
      .eq('project_id', projectId),
    admin.from('financing_structures')
      .select('structure_type, senior_debt, equity_amount, equity_pct, lender, pe_partner, notes')
      .eq('project_id', projectId),
    admin.from('compliance_items')
      .select('framework, requirement, status, due_date, notes')
      .eq('project_id', projectId),
    admin.from('project_players')
      .select('role, party:parties(full_name, company)')
      .eq('project_id', projectId),
  ])

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const userMessage = buildProjectBriefMessage({
    name: project.name,
    sector: project.sector,
    stage: project.stage,
    status: project.status,
    estimated_value: project.estimated_value,
    location: project.location,
    contract_type: project.contract_type,
    delivery_method: project.delivery_method,
    solicitation_number: project.solicitation_number,
    open_tasks: openTasks,
    updates: (updates ?? []).map((u) => ({
      summary: u.summary,
      waiting_on: (u.waiting_on ?? []) as unknown[],
      risks: (u.risks ?? []) as unknown[],
      decisions: (u.decisions ?? []) as unknown[],
      created_at: u.created_at,
    })),
    milestones: milestones ?? [],
    dd_items: ddItems ?? [],
    financing: financing ?? [],
    compliance: compliance ?? [],
    players: (players ?? []).map((p) => ({
      full_name: (p.party as unknown as { full_name: string })?.full_name ?? 'Unknown',
      company: (p.party as unknown as { company: string | null })?.company ?? null,
      role: p.role,
    })),
  })

  const result = await callGemini<string>({
    task: 'synthesize',
    systemPrompt: PROJECT_BRIEF_SYSTEM_PROMPT,
    userMessage,
    userId,
    promptVersion: BRIEF_PROMPT_VERSION,
    maxTokens: 3000,
    jsonMode: false,
  })

  return NextResponse.json({
    brief: result.data as string,
    project_id: projectId,
    project_name: project.name,
    model_used: result.model,
    latency_ms: result.latencyMs,
  })
}

// ---------------------------------------------------------------------------
// Portfolio brief
// ---------------------------------------------------------------------------

async function generatePortfolioBrief(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
) {
  const { data: projects } = await admin
    .from('projects')
    .select('id, name, sector, stage, estimated_value, location')
    .eq('status', 'active')
    .order('estimated_value', { ascending: false })

  if (!projects || projects.length === 0) {
    return NextResponse.json({ error: 'No active projects' }, { status: 404 })
  }

  // Open-task counts per project from the real task system
  const allOpenTasks = await fetchOpenTasks(admin, { limit: 500 })
  const openTaskCount = new Map<string, number>()
  for (const t of allOpenTasks) {
    if (!t.project_id) continue
    openTaskCount.set(t.project_id, (openTaskCount.get(t.project_id) ?? 0) + 1)
  }

  // For each project, get latest update, top risk, action counts, next milestone
  const enriched = await Promise.all(
    projects.map(async (p) => {
      const [
        { data: latestUpdates },
        { data: nextMs },
      ] = await Promise.all([
        admin.from('updates')
          .select('summary, waiting_on, risks, created_at')
          .eq('project_id', p.id)
          .eq('review_state', 'approved')
          .order('created_at', { ascending: false })
          .limit(1),
        admin.from('milestones')
          .select('label, target_date')
          .eq('project_id', p.id)
          .is('completed_at', null)
          .order('sort_order')
          .limit(1),
      ])

      const latest = latestUpdates?.[0]
      const risks = (latest?.risks ?? []) as { text: string; severity: string }[]
      const topRisk = risks.find((r) => r.severity === 'critical' || r.severity === 'blocker')
        ?? risks[0]

      return {
        name: p.name,
        sector: p.sector,
        stage: p.stage,
        estimated_value: p.estimated_value,
        location: p.location,
        latestUpdate: latest?.summary ?? null,
        latestUpdateDate: latest?.created_at
          ? new Date(latest.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : null,
        topRisk: topRisk?.text ?? null,
        openActionCount: openTaskCount.get(p.id) ?? 0,
        waitingOnCount: ((latest?.waiting_on ?? []) as unknown[]).length,
        nextMilestone: nextMs?.[0]?.label ?? null,
        nextMilestoneDate: nextMs?.[0]?.target_date ?? null,
      }
    })
  )

  const userMessage = buildPortfolioBriefMessage(enriched)

  const result = await callGemini<string>({
    task: 'synthesize',
    systemPrompt: PORTFOLIO_BRIEF_SYSTEM_PROMPT,
    userMessage,
    userId,
    promptVersion: BRIEF_PROMPT_VERSION,
    maxTokens: 4000,
    jsonMode: false,
  })

  return NextResponse.json({
    brief: result.data as string,
    project_id: null,
    project_name: null,
    model_used: result.model,
    latency_ms: result.latencyMs,
  })
}
