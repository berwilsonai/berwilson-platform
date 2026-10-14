/**
 * A recording's meeting row follows its thread onto the deal.
 *
 * ⚠ ONE RECORDING, TWO RECORDS, AND THEY MUST NOT DISAGREE. Every recording
 * this platform ingests produces a thread (the words, into retrieval and the
 * obligation ledger) and a meeting (the event, into `search_meetings`, onto the
 * attendees' profiles, and into the queue where it gets attached to a deal).
 * The thread is filed by `route-phase.ts`; the meeting is written `unfiled`,
 * because at the moment of transcription nothing has been routed yet. Without
 * this, the project's feed would carry the conversation while the meeting
 * register still said it belonged to nobody — and `search_meetings` filtered by
 * project would answer that there had been no calls.
 *
 * ⚠ ONLY ON A `linked` ANSWER. `route-phase.ts` draws the line: `linked` is
 * derived or asserted (a solicitation number, a learned identifier, an alias a
 * human typed), `inferred` is the platform's own guess on name similarity. An
 * inferred guess stages an update for review rather than posting it, so moving
 * the meeting register on one would assert what the feed itself is still asking
 * about. An inferred recording stays unfiled until somebody confirms it.
 *
 * ⚠ IT COVERS EVERY KIND OF RECORDING, which is what moved it here from
 * `notes/call-attach.ts` (10-14). It was written for an iPhone call recording in
 * Apple Notes; a voice memo of an in-person meeting arrives by a different
 * transport and needs exactly the same move, and leaving the original behind
 * would have been a second copy of this reasoning that drifts. The only
 * per-source part is how a thread id maps back to the meeting's key, which is
 * one switch below.
 *
 * `attachMeetingToRecord` is the shared mover and already refuses to relocate a
 * meeting that carries a record — a human's filing decision outranks this.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { attachMeetingToRecord } from '@/lib/meetings/record'
import { threadSource } from '@/lib/email-sweep/thread-source'
import { callSourceRef } from '@/lib/notes/call-record'
import { NOTE_THREAD_PREFIX } from '@/lib/notes/to-thread'
import { isVoiceMemoThread } from '@/lib/voicememos/to-thread'

export interface AttachRecordingResult {
  moved: boolean
  reason?: string
}

/**
 * The MEETING's key, recovered from its THREAD's id.
 *
 * ⚠ THE TWO ARE NOT THE SAME STRING, AND ONLY ONE SOURCE MAKES THEM DIFFER. A
 * note's thread id carries its modification time (`note:<id>:<stamp>`) so that
 * editing a note re-summarizes it, while the meeting is keyed on the stable
 * identifier alone. A voice memo has no stamp in either — its audio cannot
 * change — so the thread id IS the meeting key. Returning null rather than
 * guessing: a wrong key silently attaches nothing.
 */
export function meetingRefFromThreadId(gmailThreadId: string): string | null {
  if (isVoiceMemoThread(gmailThreadId)) return gmailThreadId
  if (gmailThreadId.startsWith(NOTE_THREAD_PREFIX)) {
    // `note:<identifier>:<YYYY-MM-DDTHH:MM:SS>` — the identifier is a UUID with
    // no colons in it, so the FIRST colon after the prefix ends it. Split from
    // the left rather than the right: a future stamp format with no colons
    // would otherwise silently take part of the identifier with it.
    const identifier = gmailThreadId.slice(NOTE_THREAD_PREFIX.length).split(':')[0]
    return identifier ? callSourceRef(identifier) : null
  }
  return null
}

/**
 * Move the meeting for this recording's thread onto the record it was filed on.
 *
 * Cheap for everything else: the source test is a string match on the thread id
 * and subject, so only an actual recording reaches the database.
 */
export async function attachRecordingMeeting(opts: {
  gmailThreadId: string | null | undefined
  subject: string | null | undefined
  certainty: string | null | undefined
  recordKind: string
  recordId: string
}): Promise<AttachRecordingResult> {
  const source = threadSource(opts.gmailThreadId, opts.subject)
  if (source !== 'call' && source !== 'recording') return { moved: false }
  if (opts.certainty !== 'linked') return { moved: false, reason: 'inferred — left unfiled' }
  if (opts.recordKind !== 'project' && opts.recordKind !== 'opportunity') return { moved: false }

  const sourceRef = meetingRefFromThreadId(opts.gmailThreadId!)
  if (!sourceRef) return { moved: false, reason: 'the thread id carries no recording identifier' }

  const supabase = createAdminClient()
  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, project_id, opportunity_id')
    .eq('drive_file_id', sourceRef)
    .maybeSingle()
  if (!meeting) return { moved: false, reason: 'no meeting row for this recording' }
  if (meeting.project_id || meeting.opportunity_id) return { moved: false, reason: 'already filed' }

  return attachMeetingToRecord(supabase, meeting.id, {
    kind: opts.recordKind as 'project' | 'opportunity',
    id: opts.recordId,
  })
}
