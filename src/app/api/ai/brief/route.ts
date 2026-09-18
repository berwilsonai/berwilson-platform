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
  PORTFOLIO_BRIEF_SYSTEM_PROMPT,
  BRIEF_PROMPT_VERSION,
  buildPortfolioBriefMessage,
} from '@/lib/ai/prompts/brief'
import {
  RECORD_BRIEF_SYSTEM_PROMPT,
  RECORD_BRIEF_PROMPT_VERSION,
} from '@/lib/ai/prompts/record-brief'
import { assembleProjectBrief } from '@/lib/briefs/record-brief'
import type { Json } from '@/types/database'

// The brief makes one model call over a large evidence pack. On the local
// model that is 60-90s — well past the default ceiling.
export const maxDuration = 300

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
  // The evidence pack is assembled deterministically — same sources, same order,
  // every time — so the model's only job is to write. See the header of
  // src/lib/briefs/record-brief.ts for why this is not an agent loop.
  const assembled = await assembleProjectBrief(admin, projectId)
  if (!assembled) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const result = await callGemini<string>({
    task: 'synthesize',
    systemPrompt: RECORD_BRIEF_SYSTEM_PROMPT,
    userMessage: assembled.prompt,
    userId,
    promptVersion: RECORD_BRIEF_PROMPT_VERSION,
    jsonMode: false,
  })

  const brief = result.data as string

  // Persisted so the print/PDF view has something to render without paying for
  // a second generation, and so a brief taken into a meeting is the same text
  // that was read on screen. Best-effort: a storage failure must not lose the
  // brief the caller is waiting on.
  const { error: saveError } = await admin.from('stored_briefs').insert({
    brief_type: 'project',
    project_id: projectId,
    title: `${assembled.projectName} — Executive Brief`,
    content: brief,
    model_used: result.model,
    latency_ms: result.latencyMs,
    metadata: {
      sources: assembled.sources,
      stats: assembled.stats,
      prompt_version: RECORD_BRIEF_PROMPT_VERSION,
    } as unknown as Json,
  })
  if (saveError) console.error('[brief] could not store project brief:', saveError.message)

  return NextResponse.json({
    brief,
    project_id: projectId,
    project_name: assembled.projectName,
    sources: assembled.sources,
    stats: assembled.stats,
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
