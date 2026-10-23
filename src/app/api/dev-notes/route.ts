import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, actorAdminClient } from '@/lib/auth/viewer'
import { DEV_NOTE_SELECT } from '@/lib/dev-notes/queries'
import { fileDevNote } from '@/lib/dev-notes/file'
import {
  DEV_NOTE_KINDS,
  DEV_NOTE_PRIORITIES,
  devNotePriority,
} from '@/lib/utils/dev-notes'

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

  // actorAdminClient stamps the signed-in user onto the PostgREST request, so
  // the activity_log trigger records WHO filed it rather than 'system'
  // (dev_notes carries log_dev_notes).
  const result = await fileDevNote(
    {
      kind: body.kind,
      title,
      body: typeof body.body === 'string' ? body.body : null,
      // Context captured from where the reporter was standing. Both come from
      // the browser.
      pagePath: typeof body.page_path === 'string' ? body.page_path : null,
      userAgent: typeof body.user_agent === 'string' ? body.user_agent : null,
      // The reporter is the SESSION, never the request body — a report filed
      // under someone else's name is worse than an anonymous one.
      reporterId: viewer.teamMemberId,
      reporterName: viewer.teamMemberName ?? viewer.email ?? 'Unknown',
      reporterEmail: viewer.email,
      // A reporter cannot set their own priority: everyone's bug is urgent, and
      // a triage field anyone can set stops being a triage field. Admins triage.
      priority: viewer.isAdmin ? devNotePriority(body.priority) : 'normal',
      // The dock shows what is already open, so a person filing from it has
      // already seen the near-duplicates. The agent has not, which is why the
      // check guards that door and not this one.
      allowDuplicate: true,
    },
    await actorAdminClient()
  )

  if (!result.ok) {
    const status = result.reason === 'invalid' ? 400 : 500
    const message = result.reason === 'duplicate' ? 'Already reported' : result.message
    return Response.json({ error: message }, { status })
  }

  return Response.json({ note: result.note })
}
