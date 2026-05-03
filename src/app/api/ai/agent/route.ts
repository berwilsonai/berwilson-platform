/**
 * POST /api/ai/agent — Run the Construction Executive Agent
 *
 * Body: { message: string, conversationId?: string, projectId?: string }
 * Returns: { response: string, conversationId: string, toolCalls?: [...] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runAgent } from '@/lib/ai/agent'
import type { Content } from '@google/generative-ai'
import type { SupabaseClient } from '@supabase/supabase-js'

// The agent_conversations and agent_messages tables are new and not yet in
// the generated Database type. Queries use `as never` casts until `npm run gen-types`.

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    message?: string
    conversationId?: string
    projectId?: string
  }

  if (!body.message?.trim()) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }

  const admin = createAdminClient()
  let conversationId = body.conversationId

  // Create or verify conversation
  if (!conversationId) {
    const { data: conv, error } = await (admin as unknown as SupabaseClient)
      .from('agent_conversations' as never)
      .insert({
        user_id: user.id,
        project_id: body.projectId ?? null,
        title: body.message.slice(0, 100),
      } as never)
      .select('id')
      .single()

    if (error || !conv) {
      return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
    }
    conversationId = (conv as { id: string }).id
  }

  // Load conversation history (last 20 messages for context)
  const { data: messages } = await (admin as unknown as SupabaseClient)
    .from('agent_messages' as never)
    .select('role, content, tool_calls, tool_results')
    .eq('conversation_id', conversationId as string)
    .order('created_at', { ascending: true })
    .limit(20)

  type HistoryMsg = { role: string; content: string }

  // Convert to Gemini Content format
  const history: Content[] = ((messages ?? []) as HistoryMsg[])
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: m.content }],
    }))

  // Save user message
  await (admin as unknown as SupabaseClient)
    .from('agent_messages' as never)
    .insert({
      conversation_id: conversationId,
      role: 'user',
      content: body.message,
    } as never)

  // Run agent
  try {
    const result = await runAgent(body.message, {
      userId: user.id,
      projectId: body.projectId,
      conversationId: conversationId!,
    }, history)

    // Save assistant message — capture the returned ID for ratings
    const { data: savedMsg } = await (admin as unknown as SupabaseClient)
      .from('agent_messages' as never)
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: result.content,
        tool_calls: result.toolCalls ? JSON.stringify(result.toolCalls) : null,
        model_used: result.model,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        latency_ms: result.latencyMs,
      } as never)
      .select('id')
      .single()

    const messageId = (savedMsg as { id?: string } | null)?.id ?? null

    // Update conversation timestamp
    await (admin as unknown as SupabaseClient)
      .from('agent_conversations' as never)
      .update({ updated_at: new Date().toISOString() } as never)
      .eq('id', conversationId as string)

    return NextResponse.json({
      response: result.content,
      conversationId,
      messageId,
      toolCalls: result.toolCalls,
      model: result.model,
      latencyMs: result.latencyMs,
    })
  } catch (err) {
    console.error('[agent] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Agent execution failed' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/ai/agent?conversationId=xxx — Load conversation history
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const conversationId = request.nextUrl.searchParams.get('conversationId')
  const projectId = request.nextUrl.searchParams.get('projectId')

  const admin = createAdminClient()

  // If conversationId given, load messages
  if (conversationId) {
    const { data: messages, error } = await (admin as unknown as SupabaseClient)
      .from('agent_messages' as never)
      .select('id, role, content, tool_calls, model_used, latency_ms, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ messages: messages ?? [] })
  }

  // Otherwise list conversations for this user/project
  let q = (admin as unknown as SupabaseClient)
    .from('agent_conversations' as never)
    .select('id, title, project_id, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (projectId) q = q.eq('project_id', projectId) as typeof q

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ conversations: data ?? [] })
}
