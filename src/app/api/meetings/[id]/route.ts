import { NextRequest } from 'next/server'
import type { TablesUpdate } from '@/lib/supabase/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'
import { canAccessMeeting } from '@/lib/meetings/access'
import { parseMeetingPatch, type Body } from '@/lib/meetings/parse'
import { syncMeetingDocument, type MeetingRecord } from '@/lib/meetings/document'
import { syncAttendeeActivity } from '@/lib/meetings/attendee-activity'

export const maxDuration = 300

interface RouteContext {
  params: Promise<{ id: string }>
}

// Read one meeting + its attached files. Used to poll transcription progress.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: meeting } = await supabase.from('meetings').select('*').eq('id', id).maybeSingle()
  if (!meeting) return Response.json({ error: 'Meeting not found' }, { status: 404 })

  const viewer = await getViewer()
  if (viewer && !(await canAccessMeeting(viewer, meeting))) return forbiddenJson()

  const { data: files } = await supabase
    .from('documents')
    .select('*')
    .eq('meeting_id', id)
    .order('uploaded_at', { ascending: false })

  return Response.json({ meeting, files: files ?? [] })
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const supabase = await actorAdminClient()
  const { data: existing, error: fetchErr } = await supabase
    .from('meetings')
    .select('scope, project_id, status')
    .eq('id', id)
    .maybeSingle()
  if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 })
  if (!existing) return Response.json({ error: 'Meeting not found' }, { status: 404 })

  const viewer = await getViewer()
  if (viewer && !(await canAccessMeeting(viewer, existing))) return forbiddenJson()

  let body: Body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = parseMeetingPatch(body)
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })

  const fields = { ...result.fields }
  const statusChanged = 'status' in fields && fields.status !== existing.status
  if (statusChanged) {
    if (fields.status === 'approved') {
      fields.approved_at = new Date().toISOString()
      fields.approved_by = viewer?.teamMemberName ?? viewer?.email ?? null
    } else {
      fields.approved_at = null
      fields.approved_by = null
    }
  }

  if (Object.keys(fields).length === 0) return Response.json({ error: 'No valid fields to update' }, { status: 400 })

  const { data: updated, error } = await supabase
    .from('meetings')
    .update(fields as TablesUpdate<'meetings'>)
    .eq('id', id)
    .select('*')
    .single()
  if (error || !updated) return Response.json({ error: error?.message ?? 'Update failed' }, { status: 500 })

  // Refresh the preserved minutes document when the record body, the AI-index
  // toggle, or the approval status changed.
  if (result.bodyChanged || 'index_ai' in fields || statusChanged) {
    await syncMeetingDocument(supabase, updated as unknown as MeetingRecord)
  }

  // Reconcile contact-profile activity when the attendee list changed. Non-fatal.
  if ('attendees' in fields) {
    await syncAttendeeActivity(supabase, updated, updated.attendees)
  }

  return Response.json({ meeting: updated })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  // Deleting a compliance record stays admin-only.
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  const supabase = await actorAdminClient()

  // Sweep the meeting's attached files (audio, transcript, exhibits, generated
  // minutes) — rows first (chunks cascade), then their storage objects. The
  // meeting delete would cascade the rows anyway (FK on delete cascade), but a
  // DB cascade can't remove the storage objects, so do it explicitly here.
  const { data: files } = await supabase
    .from('documents')
    .select('id, storage_path')
    .eq('meeting_id', id)
  const paths = (files ?? []).map((f) => f.storage_path).filter(Boolean)
  if (files && files.length) {
    await supabase.from('documents').delete().in('id', files.map((f) => f.id))
    if (paths.length) await supabase.storage.from('documents').remove(paths)
  }

  // Remove the contact-profile activity entries logged for this meeting
  // (activity_log has no FK to meetings, so the meeting delete can't cascade them).
  await supabase
    .from('activity_log')
    .delete()
    .eq('table_name', 'parties')
    .eq('action', 'meeting_attended')
    .filter('metadata->>meeting_id', 'eq', id)

  const { error } = await supabase.from('meetings').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
