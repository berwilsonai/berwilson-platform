/**
 * POST /api/ai/agent — Run the Construction Executive Agent
 *
 * Body: { message: string, conversationId?: string, projectId?: string, stream?: boolean }
 * - stream: true → Server-Sent Events: {type:'tool'|'text'|'done'|'error', ...}
 *   Tool events arrive as the agent works; text deltas stream the answer;
 *   'done' carries conversationId/messageId/toolCalls for the finished message.
 * - stream omitted → legacy JSON response { response, conversationId, toolCalls? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runAgent } from '@/lib/ai/agent'
import { checkRateLimit } from '@/lib/rate-limit'
import type { Content } from '@google/generative-ai'

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit: 20 requests per minute per user
  const rl = checkRateLimit(`agent:${user.id}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before sending another message.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
    )
  }

  const body = await request.json() as {
    message?: string
    conversationId?: string
    projectId?: string
    documentId?: string
    stream?: boolean
  }

  if (!body.message?.trim()) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }

  const admin = createAdminClient()
  let conversationId = body.conversationId

  // Create or verify conversation
  if (!conversationId) {
    const { data: conv, error } = await admin
      .from('agent_conversations')
      .insert({
        user_id: user.id,
        project_id: body.projectId ?? null,
        document_id: body.documentId ?? null,
        title: body.message.slice(0, 100),
      })
      .select('id')
      .single()

    if (error || !conv) {
      return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
    }
    conversationId = conv.id
  }

  // Load conversation history (last 20 messages for context)
  const { data: messages } = await admin
    .from('agent_messages')
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
  await admin
    .from('agent_messages')
    .insert({
      conversation_id: conversationId,
      role: 'user',
      content: body.message,
    })

  const agentContext = {
    userId: user.id,
    projectId: body.projectId,
    documentId: body.documentId,
    conversationId: conversationId!,
  }

  // ── Streaming mode (SSE) ──────────────────────────────────────────────────
  if (body.stream) {
    const encoder = new TextEncoder()
    const convId = conversationId!

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch { /* client disconnected — agent run continues so the message still persists */ }
        }

        try {
          const result = await runAgent(body.message!, agentContext, history, {
            onToolCall: (name) => send({ type: 'tool', name }),
            onTextDelta: (delta) => send({ type: 'text', delta }),
          })

          // Persist assistant message (same contract as the JSON path)
          const { data: savedMsg } = await admin
            .from('agent_messages')
            .insert({
              conversation_id: convId,
              role: 'assistant',
              content: result.content,
              tool_calls: result.toolCalls ? JSON.stringify(result.toolCalls) : null,
              model_used: result.model,
              tokens_in: result.tokensIn,
              tokens_out: result.tokensOut,
              latency_ms: result.latencyMs,
            })
            .select('id')
            .single()

          await admin
            .from('agent_conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', convId)

          send({
            type: 'done',
            conversationId: convId,
            messageId: savedMsg?.id ?? null,
            toolCalls: result.toolCalls,
            latencyMs: result.latencyMs,
          })
        } catch (err) {
          console.error('[agent] Stream error:', err)
          send({ type: 'error', message: err instanceof Error ? err.message : 'Agent execution failed' })
        } finally {
          try { controller.close() } catch { /* already closed */ }
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  }

  // ── Legacy JSON mode ──────────────────────────────────────────────────────
  try {
    const result = await runAgent(body.message, agentContext, history)

    // Save assistant message — capture the returned ID for ratings
    const { data: savedMsg } = await admin
      .from('agent_messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: result.content,
        tool_calls: result.toolCalls ? JSON.stringify(result.toolCalls) : null,
        model_used: result.model,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        latency_ms: result.latencyMs,
      })
      .select('id')
      .single()

    const messageId = savedMsg?.id ?? null

    // Update conversation timestamp
    await admin
      .from('agent_conversations')
      .update({ updated_at: new Date().toISOString() })
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
  const documentId = request.nextUrl.searchParams.get('documentId')

  const admin = createAdminClient()

  // If conversationId given, load messages
  if (conversationId) {
    const { data: messages, error } = await admin
      .from('agent_messages')
      .select('id, role, content, tool_calls, model_used, latency_ms, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ messages: messages ?? [] })
  }

  // Otherwise list conversations for this user/project/document
  let q = admin
    .from('agent_conversations')
    .select('id, title, project_id, document_id, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (projectId) q = q.eq('project_id', projectId) as typeof q
  if (documentId) q = q.eq('document_id', documentId) as typeof q

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ conversations: data ?? [] })
}
