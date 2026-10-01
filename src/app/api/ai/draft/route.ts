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
 *
 * The generation logic lives in src/lib/ai/draft.ts (shared with the agent's
 * draft_* tools). This route adds auth, rate limiting, and body validation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAccess } from '@/lib/security/guard'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { generateDraft } from '@/lib/ai/draft'

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

  const context = body.context?.trim()
  if (!context) return NextResponse.json({ error: 'context is required' }, { status: 400 })

  // generateDraft pulls the project's tasks, updates and risks into the prompt
  // and hands back prose meant to be SENT. The project id is in the body, so the
  // middleware gate cannot see it.
  const denied = await requireProjectAccess(body.project_id)
  if (denied) return denied

  const result = await generateDraft({
    type: body.type ?? 'email',
    context,
    userId: user.id,
    projectId: body.project_id,
    recipients: body.recipients,
  })

  return NextResponse.json({
    draft: result.draft,
    type: result.type,
    model_used: result.model,
    latency_ms: result.latencyMs,
  })
}
