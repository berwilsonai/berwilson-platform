/**
 * A recorded call's meeting row follows its thread onto the deal.
 *
 * ⚠ ONE CALL, TWO RECORDS, AND THEY MUST NOT DISAGREE. A recorded phone call
 * produces a thread (the words, into retrieval and the obligation ledger) and a
 * meeting (the event, into `search_meetings` and onto the contact's profile).
 * The thread gets filed by `route-phase.ts`; the meeting is written `unfiled`,
 * because at the moment of transcription nothing has been routed yet. Without
 * this, the project's feed would carry the call while the meeting register still
 * said it belonged to nobody — and `search_meetings` filtered by project would
 * answer that there had been no calls.
 *
 * ⚠ ONLY ON A `linked` ANSWER. `route-phase.ts` draws the line: `linked` is
 * derived or asserted (a solicitation number, a learned identifier, an alias a
 * human typed), `inferred` is the platform's own guess on name similarity. An
 * inferred guess stages an update for review rather than posting it, so moving
 * the meeting register on one would assert what the feed itself is still asking
 * about. An inferred call stays unfiled until somebody confirms it.
 *
 * `attachMeetingToRecord` is the shared mover and already refuses to relocate a
 * meeting that carries a record — a human's filing decision outranks this.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { attachMeetingToRecord } from '@/lib/meetings/record'

import { callSourceRef } from './call-record'
import { noteThreadKind } from './to-thread'

export interface AttachCallResult {
  moved: boolean
  reason?: string
}

/**
 * Move the meeting for this call-note thread onto the record it was filed on.
 *
 * Cheap for everything else: the kind test is a string match on the thread id
 * and subject, so only an actual recorded call reaches the database.
 */
export async function attachCallMeeting(opts: {
  gmailThreadId: string | null | undefined
  subject: string | null | undefined
  certainty: string | null | undefined
  recordKind: string
  recordId: string
}): Promise<AttachCallResult> {
  if (noteThreadKind(opts.gmailThreadId, opts.subject) !== 'call') return { moved: false }
  if (opts.certainty !== 'linked') return { moved: false, reason: 'inferred — left unfiled' }
  if (opts.recordKind !== 'project' && opts.recordKind !== 'opportunity') return { moved: false }

  // The thread id carries the note's modification time; the meeting is keyed on
  // the stable identifier. `note:<identifier>:<stamp>` → `note:<identifier>`.
  const sourceRef = callMeetingRefFromThreadId(opts.gmailThreadId!)
  if (!sourceRef) return { moved: false, reason: 'the thread id carries no note identifier' }

  const supabase = createAdminClient()
  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, project_id, opportunity_id')
    .eq('drive_file_id', sourceRef)
    .maybeSingle()
  if (!meeting) return { moved: false, reason: 'no meeting row for this call' }
  if (meeting.project_id || meeting.opportunity_id) return { moved: false, reason: 'already filed' }

  return attachMeetingToRecord(supabase, meeting.id, {
    kind: opts.recordKind as 'project' | 'opportunity',
    id: opts.recordId,
  })
}

/**
 * The meeting's key, recovered from the thread's.
 *
 * `note:<identifier>:<YYYY-MM-DDTHH:MM:SS>` — the identifier is a UUID with no
 * colons in it, so the FIRST colon after the prefix ends it. Split from the left
 * rather than the right: a future stamp format with no colons would otherwise
 * silently take part of the identifier with it.
 */
export function callMeetingRefFromThreadId(gmailThreadId: string): string | null {
  const rest = gmailThreadId.slice('note:'.length)
  const identifier = rest.split(':')[0]
  return identifier ? callSourceRef(identifier) : null
}
