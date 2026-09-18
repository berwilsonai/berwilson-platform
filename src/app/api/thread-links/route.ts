import { NextRequest } from 'next/server'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { sweepDb } from '@/lib/email-sweep/db'
import { searchCorrespondence } from '@/lib/ai/thread-embeddings'

/**
 * Filing correspondence onto a record, by hand.
 *
 * The router files what it can prove and deliberately refuses to guess, which
 * leaves most mail unfiled — 369 of 2,162 threads at the time of writing. A
 * person reading a thread knows instantly which deal it belongs to, and until
 * now had no way to say so. This is that.
 *
 * A human-filed link is stored as 'linked', not 'inferred': 'inferred' means the
 * platform matched it and wants agreement, and asking someone to review their
 * own filing decision is asking them the same question twice.
 *
 * Admin-only by default-deny — /api/thread-links is in no permissions.ts
 * allowlist, so the middleware 403s every other role; the in-route guard is
 * belt to that braces.
 */

const KINDS = ['project', 'opportunity', 'steel_deal', 'lead'] as const
type Kind = (typeof KINDS)[number]

function readKind(value: string | null): Kind | null {
  return KINDS.includes(value as Kind) ? (value as Kind) : null
}

export const maxDuration = 120

/** Filed threads, plus — on request — unfiled mail that looks like it belongs. */
export async function GET(request: NextRequest) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  const params = request.nextUrl.searchParams
  const kind = readKind(params.get('record_kind'))
  const recordId = params.get('record_id')
  if (!kind || !recordId) {
    return Response.json({ error: 'record_kind and record_id are required' }, { status: 400 })
  }

  const { data: links, error } = await sweepDb()
    .from('thread_links')
    .select('thread_id, certainty, reason')
    .eq('record_kind', kind)
    .eq('record_id', recordId)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const rows = (links ?? []) as unknown as Array<{
    thread_id: string
    certainty: string
    reason: string | null
  }>

  const filed = rows.length > 0 ? await loadThreads(rows.map((r) => r.thread_id)) : []
  const meta = new Map(rows.map((r) => [r.thread_id, r]))

  // The candidate sweep costs an embedding call plus a vector search, so it is
  // opt-in rather than part of every page load.
  let candidates: ThreadView[] = []
  const query = params.get('suggest_for')
  if (query) {
    const filedIds = new Set(rows.map((r) => r.thread_id))
    try {
      const hits = await searchCorrespondence(
        `${query} — status, decisions, next steps, open questions`,
        { limit: 12 }
      )
      const ids = [...new Set(hits.map((h) => h.threadId))].filter((id) => !filedIds.has(id))
      candidates = await loadThreads(ids)
    } catch (err) {
      // A cold or unavailable index must not break the filed list, which is the
      // part of this page that always works.
      console.error('[thread-links] candidate sweep failed:', err)
    }
  }

  return Response.json({
    filed: filed.map((t) => ({
      ...t,
      certainty: meta.get(t.id)?.certainty ?? 'inferred',
      why_filed: meta.get(t.id)?.reason ?? null,
    })),
    candidates,
  })
}

/** File a thread onto a record. */
export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: { record_kind?: string; record_id?: string; thread_id?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const kind = readKind(body.record_kind ?? null)
  if (!kind || !body.record_id || !body.thread_id) {
    return Response.json(
      { error: 'record_kind, record_id and thread_id are required' },
      { status: 400 }
    )
  }

  // applied_message_count is seeded at the thread's CURRENT length on purpose.
  // Filing a conversation is saying it belongs here, not asking for its whole
  // history to be re-posted into the record's feed — only what arrives next
  // should appear as new activity.
  const { data: thread } = await sweepDb()
    .from('email_threads')
    .select('message_count')
    .eq('id', body.thread_id)
    .maybeSingle()
  if (!thread) return Response.json({ error: 'Thread not found' }, { status: 404 })

  const { error } = await sweepDb()
    .from('thread_links')
    .upsert(
      {
        thread_id: body.thread_id,
        record_kind: kind,
        record_id: body.record_id,
        certainty: 'linked',
        confidence: 1,
        reason: `filed by ${viewer?.teamMemberName ?? 'a user'}`,
        applied_message_count: (thread as { message_count: number | null }).message_count ?? 0,
      },
      { onConflict: 'thread_id,record_kind,record_id' }
    )
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}

/** Unfile a thread — the correction path for a wrong filing. */
export async function DELETE(request: NextRequest) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  const params = request.nextUrl.searchParams
  const kind = readKind(params.get('record_kind'))
  const recordId = params.get('record_id')
  const threadId = params.get('thread_id')
  if (!kind || !recordId || !threadId) {
    return Response.json(
      { error: 'record_kind, record_id and thread_id are required' },
      { status: 400 }
    )
  }

  const { error } = await sweepDb()
    .from('thread_links')
    .delete()
    .eq('record_kind', kind)
    .eq('record_id', recordId)
    .eq('thread_id', threadId)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}

interface ThreadView {
  id: string
  subject: string | null
  mailbox: string | null
  last_at: string | null
  message_count: number | null
  attachment_count: number | null
  summary: string | null
}

async function loadThreads(ids: string[]): Promise<ThreadView[]> {
  if (ids.length === 0) return []
  const { data } = await sweepDb()
    .from('email_threads')
    .select('id, subject, mailbox, last_at, message_count, attachment_count, summary')
    .in('id', ids)
    .order('last_at', { ascending: false })

  return ((data ?? []) as unknown as Array<{
    id: string
    subject: string | null
    mailbox: string | null
    last_at: string | null
    message_count: number | null
    attachment_count: number | null
    summary: { summary?: string } | null
  }>).map((t) => ({
    id: t.id,
    subject: t.subject,
    mailbox: t.mailbox,
    last_at: t.last_at,
    message_count: t.message_count,
    attachment_count: t.attachment_count,
    summary: t.summary?.summary ?? null,
  }))
}
