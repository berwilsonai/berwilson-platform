// Shared validation for meeting-record writes — used by the create (POST) and
// update (PATCH) API routes. Route files can't export helpers, so the parsing
// lives here. Follows the dino/steel parse pattern.

import type { TablesInsert } from '@/lib/supabase/types'
import type { Json } from '@/types/database'
import {
  meetingKind,
  meetingScope,
  meetingStatus,
  parseAttendees,
  parseDecisions,
} from '@/lib/utils/meetings'

export type Body = Record<string, unknown>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function str(body: Body, key: string): string | null {
  const v = body[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function bool(body: Body, key: string): boolean {
  return body[key] === true || body[key] === 'true'
}

export type MeetingFields = TablesInsert<'meetings'>

/**
 * Validate a full meeting create. Enforces title + a valid date, and that a
 * project-scoped meeting names a project (company-scoped never does). Approval
 * fields (approved_at/by) are set in-route, not here.
 */
export function parseMeetingFields(
  body: Body,
): { ok: true; fields: MeetingFields } | { ok: false; error: string } {
  const title = str(body, 'title')
  if (!title) return { ok: false, error: 'A meeting title is required.' }

  const meeting_date = str(body, 'meeting_date')
  if (!meeting_date || !ISO_DATE.test(meeting_date)) {
    return { ok: false, error: 'A valid meeting date (YYYY-MM-DD) is required.' }
  }

  const scope = meetingScope(str(body, 'scope'))
  const project_id = scope === 'project' ? str(body, 'project_id') : null
  const opportunity_id = scope === 'opportunity' ? str(body, 'opportunity_id') : null
  if (scope === 'project' && !project_id) {
    return { ok: false, error: 'A project-scoped meeting requires a project.' }
  }
  if (scope === 'opportunity' && !opportunity_id) {
    return { ok: false, error: 'An opportunity-scoped meeting requires an opportunity.' }
  }

  const status = meetingStatus(str(body, 'status'))

  return {
    ok: true,
    fields: {
      kind: meetingKind(str(body, 'kind')),
      scope,
      project_id,
      opportunity_id,
      title,
      meeting_date,
      meeting_time: str(body, 'meeting_time'),
      location: str(body, 'location'),
      meeting_type_label: str(body, 'meeting_type_label'),
      chair: str(body, 'chair'),
      secretary: str(body, 'secretary'),
      attendees: parseAttendees(body.attendees) as unknown as Json,
      summary: str(body, 'summary'),
      minutes: str(body, 'minutes'),
      transcript: str(body, 'transcript'),
      decisions: parseDecisions(body.decisions) as unknown as Json,
      status,
      confidential: bool(body, 'confidential'),
      // board (company) defaults OFF, project/opportunity default ON — but honor an explicit value
      index_ai: 'index_ai' in body ? bool(body, 'index_ai') : scope !== 'company',
    },
  }
}

/**
 * Build a partial UPDATE from a PATCH body — only the keys actually present are
 * applied (so an approve toggle can't wipe the minutes). Returns the whitelist
 * object plus whether the record body (minutes/summary/etc.) changed, so the
 * route knows when to regenerate the minutes document.
 */
export function parseMeetingPatch(
  body: Body,
): { ok: true; fields: Record<string, unknown>; bodyChanged: boolean } | { ok: false; error: string } {
  const fields: Record<string, unknown> = {}
  let bodyChanged = false

  if ('title' in body) {
    const title = str(body, 'title')
    if (!title) return { ok: false, error: 'A meeting title cannot be empty.' }
    fields.title = title
    bodyChanged = true
  }
  if ('meeting_date' in body) {
    const d = str(body, 'meeting_date')
    if (!d || !ISO_DATE.test(d)) return { ok: false, error: 'A valid meeting date (YYYY-MM-DD) is required.' }
    fields.meeting_date = d
    bodyChanged = true
  }
  if ('kind' in body) {
    fields.kind = meetingKind(str(body, 'kind'))
    bodyChanged = true // kind label appears in the composed minutes document
  }
  for (const key of ['meeting_time', 'location', 'meeting_type_label', 'chair', 'secretary'] as const) {
    if (key in body) {
      fields[key] = str(body, key)
      bodyChanged = true
    }
  }
  if ('summary' in body) {
    fields.summary = str(body, 'summary')
    bodyChanged = true
  }
  if ('minutes' in body) {
    fields.minutes = str(body, 'minutes')
    bodyChanged = true
  }
  if ('transcript' in body) fields.transcript = str(body, 'transcript')
  if ('attendees' in body) {
    fields.attendees = parseAttendees(body.attendees) as unknown as Json
    bodyChanged = true
  }
  if ('decisions' in body) {
    fields.decisions = parseDecisions(body.decisions) as unknown as Json
    bodyChanged = true
  }
  if ('confidential' in body) fields.confidential = bool(body, 'confidential')
  if ('index_ai' in body) fields.index_ai = bool(body, 'index_ai')
  if ('status' in body) fields.status = meetingStatus(str(body, 'status'))

  return { ok: true, fields, bodyChanged }
}
