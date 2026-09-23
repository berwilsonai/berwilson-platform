import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, actorAdminClient } from '@/lib/auth/viewer'
import { DEV_NOTE_SELECT } from '@/lib/dev-notes/queries'
import {
  DEV_NOTE_KINDS,
  DEV_NOTE_PRIORITIES,
  DEV_NOTE_STATUSES,
  isDevNoteClosed,
} from '@/lib/utils/dev-notes'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * PATCH — edit / triage / check off a report.
 *
 * Who may change what, in one rule: an ADMIN may change anything; the REPORTER
 * may change their own report. That is deliberately generous — if Eric files a
 * bug and then finds it works after all, letting him tick it saves a round trip,
 * and the activity log records exactly who moved it so an admin can reopen.
 *
 * Priority stays admin-only either way (see the POST route: a triage field
 * anyone can set stops being a triage field).
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return Response.json({ error: 'Invalid body' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: existing, error: loadError } = await supabase
    .from('dev_notes')
    .select('id, status, reporter_id, resolved_at')
    .eq('id', id)
    .maybeSingle()

  if (loadError) {
    console.error('Load dev note failed:', loadError)
    return Response.json({ error: loadError.message }, { status: 500 })
  }
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

  const isReporter = !!viewer.teamMemberId && existing.reporter_id === viewer.teamMemberId
  if (!viewer.isAdmin && !isReporter) {
    return Response.json({ error: 'Not permitted' }, { status: 403 })
  }

  const patch: TablesUpdate<'dev_notes'> = {}

  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return Response.json({ error: 'A short summary is required' }, { status: 400 })
    patch.title = title.slice(0, 300)
  }
  if ('body' in body) {
    patch.body = typeof body.body === 'string' && body.body.trim() ? body.body.trim().slice(0, 8000) : null
  }
  if ('kind' in body) {
    if (!DEV_NOTE_KINDS.includes(body.kind)) {
      return Response.json({ error: 'invalid kind' }, { status: 400 })
    }
    patch.kind = body.kind
  }
  if ('priority' in body) {
    if (!viewer.isAdmin) return Response.json({ error: 'Not permitted' }, { status: 403 })
    if (!DEV_NOTE_PRIORITIES.includes(body.priority)) {
      return Response.json({ error: 'invalid priority' }, { status: 400 })
    }
    patch.priority = body.priority
  }
  if ('resolution' in body) {
    patch.resolution =
      typeof body.resolution === 'string' && body.resolution.trim()
        ? body.resolution.trim().slice(0, 4000)
        : null
  }
  if ('status' in body) {
    if (!DEV_NOTE_STATUSES.includes(body.status)) {
      return Response.json({ error: 'invalid status' }, { status: 400 })
    }
    patch.status = body.status

    // Stamp WHO settled it and when, and clear both on reopen — a reopened
    // report carrying the previous closer reads as settled by someone who has
    // not looked at it since.
    if (isDevNoteClosed(body.status)) {
      if (!isDevNoteClosed(existing.status) || !existing.resolved_at) {
        patch.resolved_at = new Date().toISOString()
        patch.resolved_by = viewer.teamMemberName ?? viewer.email ?? 'Unknown'
      }
    } else {
      patch.resolved_at = null
      patch.resolved_by = null
    }
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // actorAdminClient so the activity_log trigger names who checked it off.
  const actor = await actorAdminClient()
  const { data, error } = await actor
    .from('dev_notes')
    .update(patch)
    .eq('id', id)
    .select(DEV_NOTE_SELECT)
    .single()

  if (error) {
    console.error('Update dev note failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ note: data })
}

/**
 * DELETE — remove a report entirely. Admin-only, and the exception rather than
 * the rule: settling a note as done / won't-do keeps the record of what was
 * reported and what came of it, which is the whole point of the ledger. Delete
 * is for mistakes and duplicates.
 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin) return Response.json({ error: 'Not permitted' }, { status: 403 })

  const actor = await actorAdminClient()
  const { error } = await actor.from('dev_notes').delete().eq('id', id)
  if (error) {
    console.error('Delete dev note failed:', error)
    return Response.json({ error: 'Failed to delete report' }, { status: 500 })
  }
  return Response.json({ deleted: true })
}
