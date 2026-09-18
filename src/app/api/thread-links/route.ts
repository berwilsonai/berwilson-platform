import { NextRequest } from 'next/server'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { sweepDb } from '@/lib/email-sweep/db'
import { createAdminClient } from '@/lib/supabase/admin'

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

  // Suggestions are opt-in: they cost a scan, and the filed list is what the
  // page is for.
  let candidates: ThreadView[] = []
  if (params.get('suggest') !== null || params.get('suggest_for')) {
    const filedIds = new Set(rows.map((r) => r.thread_id))
    const names = await recordNames(kind, recordId, params.get('suggest_for'))
    candidates = await suggestThreads(names, filedIds)
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


/**
 * What this record is called — its name plus any aliases a human has given it.
 *
 * Aliases matter more here than anywhere: they exist precisely because people
 * write "Stockton" and not "Stockton Power Nexus - ER Hospital & Medevac Airport
 * Tower", and the mail worth filing is the mail that uses the short name.
 */
async function recordNames(kind: Kind, recordId: string, override: string | null): Promise<string[]> {
  if (override) return [override]

  const admin = createAdminClient()
  const out: string[] = []
  if (kind === 'project' || kind === 'opportunity') {
    const { data } = await admin
      .from(kind === 'project' ? 'projects' : 'opportunities')
      .select('name, match_aliases')
      .eq('id', recordId)
      .maybeSingle()
    const row = data as { name?: string | null; match_aliases?: string[] | null } | null
    if (row?.name) out.push(row.name)
    for (const alias of row?.match_aliases ?? []) out.push(alias)
  }
  return out.filter((n) => n.trim().length > 0)
}

/**
 * Threads that MENTION this record, by name or alias, anywhere in their text.
 *
 * Deliberately a keyword scan rather than the semantic search the brief uses.
 * The two answer different questions: semantic search is right for "what was
 * said about water rights", and wrong for "which threads are about this deal" —
 * asked the latter it returned three unrelated bid invitations, because a
 * proposal reads like a proposal whatever it is for. Naming the deal is the
 * signal, and it is one a person can check at a glance before filing.
 */
async function suggestThreads(names: string[], filedIds: Set<string>): Promise<ThreadView[]> {
  if (names.length === 0) return []

  const seen = new Map<string, ThreadView>()
  for (const name of names) {
    // Commas, parentheses and quotes are structural in a PostgREST logic tree,
    // so a record name containing them would be parsed as more filter rather
    // than as a value. Stripping them widens the match slightly and never
    // breaks the query.
    const safe = name.replace(/[(),."']/g, ' ').trim()
    if (safe.length < 3) continue

    const { data, error } = await sweepDb()
      .from('email_threads')
      .select('id, subject, mailbox, last_at, message_count, attachment_count, summary')
      .or(`subject.ilike."%${safe}%",raw_markdown.ilike."%${safe}%"`)
      .order('last_at', { ascending: false })
      .limit(25)
    if (error) {
      console.error('[thread-links] suggestion scan failed:', error.message)
      continue
    }

    for (const raw of (data ?? []) as unknown as Array<{
      id: string
      subject: string | null
      mailbox: string | null
      last_at: string | null
      message_count: number | null
      attachment_count: number | null
      summary: { summary?: string } | null
    }>) {
      if (filedIds.has(raw.id) || seen.has(raw.id)) continue
      seen.set(raw.id, {
        id: raw.id,
        subject: raw.subject,
        mailbox: raw.mailbox,
        last_at: raw.last_at,
        message_count: raw.message_count,
        attachment_count: raw.attachment_count,
        summary: raw.summary?.summary ?? null,
      })
    }
  }

  return [...seen.values()]
    .sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''))
    .slice(0, 25)
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
