import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, actorAdminClient } from '@/lib/auth/viewer'
import { notifyTeam } from '@/lib/notifications'
import { DEV_NOTE_SELECT, devNoteRecipients } from '@/lib/dev-notes/queries'
import {
  DEV_NOTE_KINDS,
  DEV_NOTE_PRIORITIES,
  DEV_NOTE_KIND_LABELS,
  devNoteKind,
  devNotePriority,
} from '@/lib/utils/dev-notes'
import type { TablesInsert } from '@/lib/supabase/types'

/**
 * Developer Notes API — in-app bug reports and feature requests.
 *
 * ⚠ `/api/dev-notes` is allowlisted for EVERY role in permissions.ts, because
 * the people most likely to hit a bug are the ones with the least access. That
 * allowlist is a prefix match and is NOT method-aware, so these routes carry
 * their own guards rather than relying on the middleware — the layer whose job
 * is not to trust the one above it shouldn't.
 */

/** GET — list reports (?status=open|closed, default all). */
export async function GET(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')

  const supabase = createAdminClient()
  let query = supabase
    .from('dev_notes')
    .select(DEV_NOTE_SELECT)
    .order('created_at', { ascending: false })

  // Everyone sees every report. This is feedback about the tool itself, not
  // portfolio data — and seeing what has already been reported is what stops
  // the same bug arriving five times.
  if (status === 'open') query = query.in('status', ['open', 'in_progress'])
  if (status === 'closed') query = query.in('status', ['done', 'wont_do'])

  const { data, error } = await query
  if (error) {
    console.error('List dev notes failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ notes: data ?? [] })
}

/** POST — file a report. */
export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return Response.json({ error: 'Invalid body' }, { status: 400 })

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return Response.json({ error: 'A short summary is required' }, { status: 400 })
  if (body.kind && !DEV_NOTE_KINDS.includes(body.kind)) {
    return Response.json({ error: 'invalid kind' }, { status: 400 })
  }
  if (body.priority && !DEV_NOTE_PRIORITIES.includes(body.priority)) {
    return Response.json({ error: 'invalid priority' }, { status: 400 })
  }

  const kind = devNoteKind(body.kind)

  const row: TablesInsert<'dev_notes'> = {
    kind,
    title: title.slice(0, 300),
    body: typeof body.body === 'string' && body.body.trim() ? body.body.trim().slice(0, 8000) : null,
    // Context captured from where the reporter was standing. Both come from the
    // browser, so both are bounded here.
    page_path: typeof body.page_path === 'string' ? body.page_path.slice(0, 500) || null : null,
    user_agent: typeof body.user_agent === 'string' ? body.user_agent.slice(0, 500) || null : null,
    // The reporter is the SESSION, never the request body — a report filed
    // under someone else's name is worse than an anonymous one.
    reporter_id: viewer.teamMemberId,
    reporter_name: viewer.teamMemberName ?? viewer.email ?? 'Unknown',
    // A reporter cannot set their own priority: everyone's bug is urgent, and a
    // triage field anyone can set stops being a triage field. Admins triage.
    priority: viewer.isAdmin ? devNotePriority(body.priority) : 'normal',
    status: 'open',
  }

  // actorAdminClient stamps the signed-in user onto the PostgREST request, so
  // the activity_log trigger records WHO filed it rather than 'system'.
  const supabase = await actorAdminClient()
  const { data, error } = await supabase
    .from('dev_notes')
    .insert(row)
    .select(DEV_NOTE_SELECT)
    .single()

  if (error) {
    console.error('Create dev note failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Tell the admins. A report nobody is told about sits in a table nobody
  // opens — the silent-queue failure this platform has hit repeatedly.
  // Best-effort in the strongest sense: it must never fail the report.
  try {
    const admins = await devNoteRecipients()
    if (admins.length > 0) {
      await notifyTeam(
        [
          {
            kind: 'dev_note',
            title: `${DEV_NOTE_KIND_LABELS[kind]} reported: ${row.title}`,
            body: row.body ? row.body.slice(0, 280) : row.page_path ? `On ${row.page_path}` : null,
            href: `/dev-notes?note=${data.id}`,
            actorName: row.reporter_name,
            // Excludes the reporter from their own bell row when they are
            // themselves an admin.
            actorEmail: viewer.email,
          },
        ],
        { recipients: admins }
      )
    }
  } catch (err) {
    console.error('[dev-notes] notify failed:', err instanceof Error ? err.message : String(err))
  }

  return Response.json({ note: data })
}
