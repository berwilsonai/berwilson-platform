/**
 * POST /api/ai/agent — Run the Construction Executive Agent
 *
 * Body: { message: string, conversationId?: string, projectId?: string, stream?: boolean }
 * - stream: true → Server-Sent Events: {type:'tool'|'text'|'reset'|'done'|'error', ...}
 *   Tool events arrive as the agent works; text deltas stream the answer;
 *   'reset' discards text streamed so far (it was narration before more tool
 *   work, not the answer); 'done' carries conversationId/messageId/toolCalls.
 * - stream omitted → legacy JSON response { response, conversationId, toolCalls? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runAgent } from '@/lib/ai/agent'
import { agentTimeBudgetMs, liveRuns } from '@/lib/ai/run-state'
import { notifyAnswer } from '@/lib/ai/answer-notify'
import { publicOrigin } from '@/lib/utils/request-origin'
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
    opportunityId?: string
    documentId?: string
    stream?: boolean
  }

  if (!body.message?.trim()) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }

  // `agent_conversations` carries a CHECK that at most one deal record is
  // named. Refused here rather than at the insert, so a caller that scopes a
  // conversation twice reads its own mistake instead of a 500.
  if (body.projectId && body.opportunityId) {
    return NextResponse.json(
      { error: 'A conversation can be scoped to a project or an opportunity, not both.' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()
  let conversationId = body.conversationId

  // Create or verify conversation
  if (!conversationId) {
    const { data: conv, error } = await admin
      .from('agent_conversations')
      .insert({
        user_id: user.id,
        // Both pointers on every insert, never just the one that is set: the
        // pair is what the CHECK reads (§12 — the columns a discriminator
        // governs travel together).
        project_id: body.projectId ?? null,
        opportunity_id: body.opportunityId ?? null,
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

  // Load conversation history — the last 20 messages for context.
  //
  // ⚠ ORDER DESC, THEN REVERSE. This read was `ascending: true` with the same
  // `.limit(20)` under this same comment, which returns the FIRST twenty
  // messages, not the last. It had never bitten — the longest conversation on
  // the box is 12 messages — but a conversation that passed twenty would have
  // started answering from its own opening while silently dropping every
  // recent turn, which reads as the agent losing its memory rather than as a
  // bug. Latent, cheap, fixed.
  const { data: messages } = await admin
    .from('agent_messages')
    .select('role, content, tool_calls, tool_results, created_at')
    .eq('conversation_id', conversationId as string)
    .order('created_at', { ascending: false })
    .limit(20)

  type HistoryMsg = { role: string; content: string }

  // Convert to Gemini Content format, oldest first — the order the model reads.
  const history: Content[] = ((messages ?? []) as HistoryMsg[])
    .slice()
    .reverse()
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: m.content }],
    }))

  // Save the user message, and mark it as the job record for this turn.
  //
  // This row is what a later mount reattaches to — another tab, a reload, the
  // dock after it remounted on a record boundary. The run itself already
  // survives the client leaving (nothing here reads `request.signal`); what
  // was missing was any way to find out that it had.
  const runStartedAt = new Date().toISOString()
  const { data: userRow } = await admin
    .from('agent_messages')
    .insert({
      conversation_id: conversationId,
      role: 'user',
      content: body.message,
      run_state: 'running',
      run_started_at: runStartedAt,
    })
    .select('id')
    .single()

  const runRowId = (userRow as { id: string } | null)?.id ?? null

  /**
   * Close the job record out.
   *
   * ⚠ CALLED FROM BOTH BRANCHES AND FROM BOTH OUTCOMES. A verdict written only
   * on the happy path leaves `running` behind on every error, and a reader
   * pairing it with the clock would then wait the full time budget for an
   * answer that already failed. The clock covers the one case this cannot —
   * a `launchctl kickstart`, which kills the process before either verdict is
   * written, and a deploy IS a kickstart (§12).
   */
  const settleRun = async (state: 'answered' | 'failed') => {
    if (!runRowId) return
    const { error } = await admin
      .from('agent_messages')
      .update({ run_state: state })
      .eq('id', runRowId)
    if (error) console.warn(`[agent] could not mark run ${state}:`, error.message)
  }

  // The origin has to be read HERE, from the request headers, because the
  // streaming branch runs on after the handler has returned and no longer has
  // a request to ask. ⚠ `publicOrigin`, never `nextUrl.origin` — behind
  // `tailscale serve` the Host header is localhost and every emailed link
  // would point at the recipient's own machine (§12).
  const origin = publicOrigin(request.headers)

  /**
   * Text and mail the answer, if it took long enough that nobody is still
   * watching. The text carries the question and a link that opens the
   * conversation; the email carries the whole answer.
   *
   * Non-fatal by construction: a failed notification must never turn a
   * finished answer into an error. It is already saved and already on screen
   * for anyone who stayed.
   */
  const announce = async (messageId: string | null, answer: string, latencyMs: number) => {
    if (!messageId || !user.email) return
    try {
      const outcome = await notifyAnswer({
        messageId,
        conversationId: conversationId!,
        to: user.email,
        question: body.message!,
        answer,
        latencyMs,
        origin,
        projectId: body.projectId,
        /*
          ⚠ THE CONNECTION ANSWERS THIS IN ONE DIRECTION ONLY, WHICH IS WHY IT
          IS `false | null` AND NEVER `true`.

          A DROPPED connection is proof nobody is there — the tab was closed or
          the browser was killed — so that one is definitive and the answer is
          sent however fast it came back. An OPEN connection proves nothing:
          `AskBerAIDock` stays mounted while CLOSED so the conversation survives
          ⌘J, which is the right behaviour and means the stream is still held by
          a dock the asker walked away from ten minutes ago.

          So an open connection reports `null` — not known — and falls back to
          the duration, which is exactly the old behaviour and therefore not a
          regression for anyone. The client closes the gap: it knows whether the
          dock was open and the tab visible, and reports it to
          `/api/ai/agent/missed`. `notifyAnswer` is idempotent on
          `notification_log`'s unique key, so both paths firing sends once.
        */
        watched: request.signal.aborted ? false : null,
      })
      if (outcome.emailed || outcome.texted) console.log(`[agent] answer sent — ${outcome.reason}`)
    } catch (err) {
      console.warn('[agent] answer notification failed:', err instanceof Error ? err.message : err)
    }
  }

  const agentContext = {
    userId: user.id,
    projectId: body.projectId,
    opportunityId: body.opportunityId,
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

        // Heartbeat: the local model can reason for 60s+ without emitting a
        // single visible token, and Safari (especially iOS) kills connections
        // that go silent that long ("Load failed"). Keep bytes flowing.
        const heartbeat = setInterval(() => send({ type: 'ping' }), 10_000)

        try {
          const result = await runAgent(body.message!, agentContext, history, {
            onToolCall: (name) => send({ type: 'tool', name }),
            onTextDelta: (delta) => send({ type: 'text', delta }),
            // The agent narrated before going back for more evidence. Clear
            // what the client has rendered so the visible message matches the
            // one about to be stored.
            onTextReset: () => send({ type: 'reset' }),
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

          await settleRun('answered')

          send({
            type: 'done',
            conversationId: convId,
            messageId: savedMsg?.id ?? null,
            toolCalls: result.toolCalls,
            latencyMs: result.latencyMs,
          })

          /*
            ⚠ AFTER `done`, AND STILL AWAITED INSIDE THE STREAM.

            Two claim rows and two Gmail sends, ~2s — small, but it is work
            done for the reader who LEFT and there is no reason to make the
            reader who STAYED wait for it. (It briefly cost 15-40s, when the
            text was a model-written summary; that is gone, and the ordering
            it forced was right anyway.)

            It stays inside `start()` rather than being fired and forgotten:
            the stream is not finished until `close()` in the `finally` below,
            so this is work the request still owns. §12 — work fired off after
            a handler has returned dies with the next kickstart, and a deploy
            is a kickstart.
          */
          await announce(savedMsg?.id ?? null, result.content, result.latencyMs)
        } catch (err) {
          console.error('[agent] Stream error:', err)
          await settleRun('failed')
          send({ type: 'error', message: err instanceof Error ? err.message : 'Agent execution failed' })
        } finally {
          clearInterval(heartbeat)
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

    await settleRun('answered')
    await announce(messageId, result.content, result.latencyMs)

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
    await settleRun('failed')
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
  const opportunityId = request.nextUrl.searchParams.get('opportunityId')
  const documentId = request.nextUrl.searchParams.get('documentId')

  const admin = createAdminClient()

  // If conversationId given, load messages (only if the conversation is yours)
  if (conversationId) {
    const { data: conv } = await admin
      .from('agent_conversations')
      .select('user_id')
      .eq('id', conversationId)
      .single()
    if (!conv || conv.user_id !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { data: messages, error } = await admin
      .from('agent_messages')
      .select('id, role, content, tool_calls, model_used, latency_ms, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Is the last question on this conversation still being answered? The
    // client needs this on the SAME call that loads the messages, or a reload
    // mid-run renders the question with no sign that anything is happening.
    const runs = await liveRuns({
      windowMs: agentTimeBudgetMs(),
      conversationIds: [conversationId],
    })

    return NextResponse.json({ messages: messages ?? [], inFlight: runs[0] ?? null })
  }

  // Otherwise list conversations for this user/project/document
  let q = admin
    .from('agent_conversations')
    .select('id, title, project_id, opportunity_id, document_id, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (projectId) q = q.eq('project_id', projectId) as typeof q
  if (opportunityId) q = q.eq('opportunity_id', opportunityId) as typeof q
  if (documentId) q = q.eq('document_id', documentId) as typeof q

  // ⚠ `scope=portfolio` means all three pointers NULL, which is not the same
  // as passing no filter at all. With no filter this endpoint returns every
  // conversation the user owns, so the global ⌘J dock asking for "my most
  // recent" would get back whichever PROJECT conversation happened to be
  // newest and resume that — a deal's chat opening on the dashboard. The dock
  // consequently resumed nothing at all, which is why every portfolio-wide
  // question has started from a blank slate since the dock was built.
  if (request.nextUrl.searchParams.get('scope') === 'portfolio') {
    q = q.is('project_id', null).is('opportunity_id', null).is('document_id', null) as typeof q
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const conversations = (data ?? []) as Array<{ id: string }>

  // Any question of THESE conversations still being worked on? Scoped to the
  // conversations just listed, so one reader never learns about another's.
  //
  // The full time budget is the horizon here, not the sweeps' shorter one: a
  // 16.8-minute answer is real and on record, and a reattach that gave up
  // sooner would be the 240s recovery cap all over again.
  const runs = await liveRuns({
    windowMs: agentTimeBudgetMs(),
    conversationIds: conversations.map(c => c.id),
  })

  return NextResponse.json({ conversations, inFlight: runs[0] ?? null })
}

/**
 * DELETE /api/ai/agent?conversationId=xxx — Delete one of your own conversations
 * (its messages cascade). Only the owner can delete it.
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const conversationId = request.nextUrl.searchParams.get('conversationId')
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify ownership before deleting
  const { data: conv } = await admin
    .from('agent_conversations')
    .select('user_id')
    .eq('id', conversationId)
    .single()
  if (!conv || conv.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await admin
    .from('agent_conversations')
    .delete()
    .eq('id', conversationId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
