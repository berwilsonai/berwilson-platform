/**
 * The dock's two small errands: say what is unread, and say what was missed.
 *
 * GET  — how many answers are waiting, and the newest one, for the dock badge.
 * POST — the client's verdict on one answer: seen, or missed while away.
 *
 * ⚠ WHY THE CLIENT GETS A VOTE AT ALL. Whether somebody was watching is a fact
 * the browser holds and the server cannot infer: the dock stays mounted while
 * CLOSED (so the conversation survives ⌘J), which means an open SSE connection
 * says nothing about whether anyone is looking at it. The route's own signal is
 * only conclusive when the connection DROPPED. This is the other half.
 *
 * ⚠ AND IT IS NOT A TRUST PROBLEM, BECAUSE NEITHER VERDICT CAN DO HARM. The
 * worst a wrong `seen` can do is withhold an email about the reader's own
 * question; the worst a wrong `missed` can do is send one. Both are scoped to
 * conversations the caller owns, checked below — a messageId alone is not
 * authority over it (§12: a one-table route with one write verb is exactly
 * where the record check goes missing).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyAnswer } from '@/lib/ai/answer-notify'
import { publicOrigin } from '@/lib/utils/request-origin'

export const maxDuration = 60

/** The newest unread answers for this user, for the dock badge. */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: convs, error: convErr } = await admin
    .from('agent_conversations')
    .select('id')
    .eq('user_id', user.id)
  // §12: check the error on every select — a zero from a broken query and a
  // zero from an empty table are the same value and opposite facts, and here
  // the second one silently turns the badge off.
  if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 })
  if (!convs?.length) return NextResponse.json({ unread: 0, newest: null })

  const ids = convs.map((c) => c.id)
  const { data: rows, error } = await admin
    .from('agent_messages')
    .select('id, conversation_id, content, created_at')
    .in('conversation_id', ids)
    .eq('role', 'assistant')
    .is('seen_at', null)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const newest = rows?.[0]
  return NextResponse.json({
    unread: rows?.length ?? 0,
    newest: newest
      ? {
          messageId: newest.id,
          conversationId: newest.conversation_id,
          // Enough to recognise WHICH answer, never enough to read it from a
          // badge and skip opening it.
          preview: (newest.content ?? '').trim().split('\n').find((l) => l.trim())?.slice(0, 110) ?? '',
        }
      : null,
  })
}

/**
 * Body: { messageId, seen: boolean }
 *
 * `seen: true`  — it was on screen; stamp it and send nothing.
 * `seen: false` — it landed while they were away; send the email and the text.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const messageId = typeof body.messageId === 'string' ? body.messageId : ''
  if (!messageId) return NextResponse.json({ error: 'messageId is required' }, { status: 400 })
  const seen = body.seen === true

  const admin = createAdminClient()

  // ⚠ READ THE PARENT BEFORE THE WRITE. The body carries only an id, which is
  // precisely why this check gets skipped (§12) — a message id is not authority
  // over the conversation it belongs to.
  const { data: msg, error } = await admin
    .from('agent_messages')
    .select('id, content, latency_ms, seen_at, created_at, conversation_id, agent_conversations!inner(id, user_id, project_id)')
    .eq('id', messageId)
    .eq('role', 'assistant')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!msg) return NextResponse.json({ error: 'No such answer.' }, { status: 404 })

  const conv = msg.agent_conversations as unknown as { id: string; user_id: string; project_id: string | null }
  if (conv.user_id !== user.id) {
    return NextResponse.json({ error: 'Not your conversation.' }, { status: 403 })
  }

  if (seen) {
    const now = new Date().toISOString()
    // `all` is what opening the dock sends: having walked over to read one
    // answer, the reader has dealt with the badge, and leaving the others
    // unread would make a number they cannot clear — which is how the deleted
    // notification inbox ended up with 52 rows and zero dismissals.
    if (body.all === true) {
      const { data: mine } = await admin
        .from('agent_conversations').select('id').eq('user_id', user.id)
      const ids = (mine ?? []).map((c) => c.id)
      // ⚠ Chunked: a filter rides in the query string, so `.in()` with a
      // thousand uuids is a 37KB GET that Kong refuses outright (§12).
      for (let i = 0; i < ids.length; i += 200) {
        await admin
          .from('agent_messages')
          .update({ seen_at: now })
          .in('conversation_id', ids.slice(i, i + 200))
          .eq('role', 'assistant')
          .is('seen_at', null)
      }
      return NextResponse.json({ seen: true, notified: false, all: true })
    }
    if (!msg.seen_at) {
      await admin.from('agent_messages').update({ seen_at: now }).eq('id', messageId)
    }
    return NextResponse.json({ seen: true, notified: false })
  }

  // Missed. The question is the user turn immediately before this answer.
  const { data: asked } = await admin
    .from('agent_messages')
    .select('content')
    .eq('conversation_id', conv.id)
    .eq('role', 'user')
    .lt('created_at', msg.created_at ?? new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!user.email) return NextResponse.json({ seen: false, notified: false, reason: 'no address' })

  const outcome = await notifyAnswer({
    messageId,
    conversationId: conv.id,
    to: user.email,
    question: asked?.content ?? 'your question',
    answer: msg.content ?? '',
    latencyMs: msg.latency_ms ?? 0,
    origin: publicOrigin(request.headers),
    projectId: conv.project_id ?? undefined,
    // The whole point of this route: the client KNOWS nobody was looking.
    watched: false,
  })

  return NextResponse.json({ seen: false, notified: outcome.emailed || outcome.texted, reason: outcome.reason })
}
