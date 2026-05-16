/**
 * POST /api/ai/draft
 *
 * Draft outbound content: follow-up emails, meeting agendas, status reports.
 * Body: {
 *   type: 'email' | 'agenda' | 'report',
 *   project_id?: string,
 *   context: string,       // user's instruction (e.g. "follow up with Turner about schedule slip")
 *   recipients?: string[], // names or emails
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callGemini } from '@/lib/ai/gemini'
import { checkRateLimit } from '@/lib/rate-limit'

const DRAFT_PROMPTS: Record<string, string> = {
  email: `You are drafting a professional email on behalf of a construction executive at Ber Wilson.

Rules:
- Write in the executive's voice — direct, professional, confident. Not stiff or overly formal.
- Reference specific facts from the project data provided (dates, amounts, names).
- Keep it concise — busy people don't read long emails.
- Include a clear ask or next step at the end.
- Don't use placeholder brackets [like this]. Use the actual data or omit.
- Format as a ready-to-send email with Subject line, body, and suggested closing.`,

  agenda: `You are drafting a meeting agenda for a construction executive at Ber Wilson.

Rules:
- Start with meeting title, date, and attendees.
- Organize by topic with time allocations.
- Under each topic, list specific discussion points with real data (not vague).
- Include an "Open Items for Resolution" section pulling from project action items.
- End with "Next Steps / Assignments" section.
- Keep it to one page — 10-15 minutes per topic max.`,

  report: `You are drafting a status report for a construction executive at Ber Wilson.

Rules:
- Start with Executive Summary (3-4 sentences covering portfolio health).
- Then project-by-project updates: stage, value, recent activity, risks, next milestone.
- Include a "Decisions Required" section for anything needing executive action.
- Include an "Upcoming Deadlines" section (next 14 days).
- Use specific numbers, dates, and names throughout.
- Keep it scannable — bullet points and headers, not paragraphs.`,
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = checkRateLimit(`draft:${user.id}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let body: { type?: string; project_id?: string; context?: string; recipients?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const draftType = body.type ?? 'email'
  const context = body.context?.trim()
  if (!context) return NextResponse.json({ error: 'context is required' }, { status: 400 })

  const systemPrompt = DRAFT_PROMPTS[draftType] ?? DRAFT_PROMPTS.email
  const admin = createAdminClient()

  // Gather project context
  let projectContext = ''
  if (body.project_id) {
    const [{ data: project }, { data: updates }, { data: milestones }] = await Promise.all([
      admin.from('projects').select('name, sector, stage, estimated_value, location').eq('id', body.project_id).single(),
      admin.from('updates')
        .select('summary, action_items, waiting_on, risks, decisions, created_at')
        .eq('project_id', body.project_id)
        .eq('review_state', 'approved')
        .order('created_at', { ascending: false })
        .limit(5),
      admin.from('milestones')
        .select('label, target_date, completed_at')
        .eq('project_id', body.project_id)
        .is('completed_at', null)
        .order('target_date')
        .limit(3),
    ])

    if (project) {
      projectContext = `\nPROJECT: ${project.name}
Stage: ${project.stage} | Value: $${((project.estimated_value ?? 0) / 1_000_000).toFixed(1)}M | Sector: ${project.sector} | Location: ${project.location ?? 'N/A'}

RECENT UPDATES:
${(updates ?? []).map(u => `[${new Date(u.created_at ?? '').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}] ${u.summary}\n  Actions: ${JSON.stringify(u.action_items).slice(0, 300)}\n  Waiting: ${JSON.stringify(u.waiting_on).slice(0, 200)}\n  Risks: ${JSON.stringify(u.risks).slice(0, 200)}`).join('\n\n') || '(none)'}

UPCOMING MILESTONES:
${(milestones ?? []).map(m => `- ${m.label} — ${m.target_date}`).join('\n') || '(none)'}
`
    }
  } else if (draftType === 'report') {
    // For reports without a specific project, get portfolio overview
    const { data: projects } = await admin
      .from('projects')
      .select('id, name, sector, stage, estimated_value')
      .eq('status', 'active')

    if (projects && projects.length > 0) {
      const enriched = await Promise.all(projects.map(async p => {
        const { data: latestUpdate } = await admin.from('updates')
          .select('summary, action_items, risks, created_at')
          .eq('project_id', p.id)
          .eq('review_state', 'approved')
          .order('created_at', { ascending: false })
          .limit(1)

        const { data: nextMs } = await admin.from('milestones')
          .select('label, target_date')
          .eq('project_id', p.id)
          .is('completed_at', null)
          .order('target_date')
          .limit(1)

        const u = latestUpdate?.[0]
        return `${p.name} (${p.stage}, $${((p.estimated_value ?? 0) / 1_000_000).toFixed(1)}M):
  Latest: ${u?.summary?.slice(0, 150) ?? 'no updates'}
  Actions: ${JSON.stringify(u?.action_items ?? []).slice(0, 150)}
  Risks: ${JSON.stringify(u?.risks ?? []).slice(0, 150)}
  Next milestone: ${nextMs?.[0]?.label ?? 'none'} — ${nextMs?.[0]?.target_date ?? ''}`
      }))

      projectContext = `\nPORTFOLIO OVERVIEW:\n${enriched.join('\n\n')}\n`
    }
  }

  // Match recipients to contacts
  let recipientContext = ''
  if (body.recipients && body.recipients.length > 0) {
    for (const r of body.recipients.slice(0, 5)) {
      const pattern = `%${r.split(' ')[0]}%`
      const { data: parties } = await admin
        .from('parties')
        .select('full_name, company, title, email')
        .or(`full_name.ilike.${pattern},email.ilike.${pattern}`)
        .limit(1)
      if (parties && parties.length > 0) {
        const p = parties[0]
        recipientContext += `\nRecipient: ${p.full_name}${p.title ? `, ${p.title}` : ''}${p.company ? ` at ${p.company}` : ''} <${p.email ?? 'no email on file'}>`
      }
    }
  }

  const userMessage = `INSTRUCTIONS: ${context}
${recipientContext}
${projectContext}`

  const result = await callGemini<string>({
    task: 'synthesize',
    systemPrompt,
    userMessage,
    userId: user.id,
    promptVersion: `draft-${draftType}-v1`,
    maxTokens: 2500,
    jsonMode: false,
  })

  return NextResponse.json({
    draft: result.data as string,
    type: draftType,
    model_used: result.model,
    latency_ms: result.latencyMs,
  })
}
