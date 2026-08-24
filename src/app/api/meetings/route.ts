import { NextRequest } from 'next/server'
import { getViewer, canAccessProject, canAccessOpportunity, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'
import { parseMeetingFields, type Body } from '@/lib/meetings/parse'
import { syncMeetingDocument, type MeetingRecord } from '@/lib/meetings/document'
import { syncAttendeeActivity } from '@/lib/meetings/attendee-activity'

// Regenerating + embedding the minutes document can take a bit on the local model.
export const maxDuration = 300

// /api/meetings is not in any role allowlist (admin-only via middleware); the
// getViewer checks are defense-in-depth + forward-compatible with opening
// project-scoped meetings to project_managers later.
export async function POST(request: NextRequest) {
  let body: Body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = parseMeetingFields(body)
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) {
    if (result.fields.scope === 'company') return forbiddenJson()
    if (result.fields.scope === 'project') {
      if (!result.fields.project_id || !(await canAccessProject(viewer, result.fields.project_id))) {
        return forbiddenJson()
      }
    } else if (result.fields.scope === 'opportunity') {
      if (!result.fields.opportunity_id || !canAccessOpportunity(viewer, result.fields.opportunity_id)) {
        return forbiddenJson()
      }
    }
  }

  // Stamp approval when a meeting is created already approved.
  const fields = { ...result.fields }
  if (fields.status === 'approved') {
    fields.approved_at = new Date().toISOString()
    fields.approved_by = viewer?.teamMemberName ?? viewer?.email ?? null
  }

  const supabase = await actorAdminClient()
  const { data, error } = await supabase.from('meetings').insert(fields).select('*').single()
  if (error || !data) return Response.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

  // Generate the preserved minutes document (+ embed when index_ai). Non-fatal.
  await syncMeetingDocument(supabase, data as unknown as MeetingRecord)

  // Log the meeting on each linked contact's profile. Non-fatal.
  await syncAttendeeActivity(supabase, data, data.attendees)

  return Response.json({ meeting: data })
}
