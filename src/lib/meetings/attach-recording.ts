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
 * one switch below — and the third source (audio dropped in Drive, 10-18) cost
 * exactly one line there, which is what this file being shared was for.
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
import { isDriveAudioThread } from '@/lib/driveaudio/to-thread'
import { isUploadThread } from '@/lib/audio/upload-ref'

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
 * identifier alone. Neither a voice memo nor a file in the Drive intake folder
 * has a stamp in either — audio cannot change — so for both of those the thread
 * id IS the meeting key. Returning null rather than guessing: a wrong key
 * silently attaches nothing.
 */
export function meetingRefFromThreadId(gmailThreadId: string): string | null {
  if (isVoiceMemoThread(gmailThreadId)) return gmailThreadId
  if (isDriveAudioThread(gmailThreadId)) return gmailThreadId
  // ⚠ THE THIRD SOURCE NEEDED ITS OWN ARM, and forgetting it was caught by the
  // live upload verification on 2026-10-19: everything else passed — the
  // transcript, the asserted `linked` link, 3 obligations, 2 tasks, an update
  // on the record — and the meeting sat `scope='unfiled', project_id=null`,
  // because this function returned null for an `upload:` id and so
  // `fileMeetingFromThreadLinks` could not find the row to move. §12 exactly:
  // when a function branches on where something came from, every source that
  // can reach it needs an arm, not just the one being added today.
  if (isUploadThread(gmailThreadId)) return gmailThreadId
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

/**
 * The other direction: the meeting is new, and its thread may ALREADY be filed.
 *
 * ⚠ THIS CLOSES A HOLE THAT WAS LIVE AND SILENT, MEASURED 2026-10-18 ON THE REAL
 * DATABASE. `attachRecordingMeeting` above is called from `apply-phase.ts`, and
 * its comment there says it sits outside the `needsText` block on purpose
 * because "the meeting may still be sitting unfiled". True, and not enough: it
 * is inside the loop that `continue`s past any link already caught up on text
 * AND attachments. Every recording sweep creates its `meetings` row AFTER
 * running the phases — the recap costs a model pass, so it goes last — which
 * means at the moment apply visits the link there is no meeting to move, and by
 * the next run the link has nothing owing and is never visited again.
 *
 * So the meeting stayed `unfiled` forever while its own thread sat correctly
 * linked. Found on the Drive audio source's first run and checked against the
 * two voice memos already on the box: BOTH were in exactly this state, one of
 * them the 67-minute Tensor construction-management meeting.
 *
 * §12, third occurrence: a cleanup that is a side effect of having work to do
 * never reaches the rows with no work. The remedy is to ask from the side that
 * has just changed — a sweep calls this right after it writes the meeting, and
 * it is a no-op (one indexed read) when the thread is not yet filed.
 */
export async function fileMeetingFromThreadLinks(
  threadId: string
): Promise<AttachRecordingResult> {
  const supabase = createAdminClient()

  const { data: thread } = await supabase
    .from('email_threads')
    .select('gmail_thread_id, subject')
    .eq('id', threadId)
    .maybeSingle()
  if (!thread?.gmail_thread_id) return { moved: false, reason: 'no such thread' }

  const source = threadSource(thread.gmail_thread_id, thread.subject)
  if (source !== 'call' && source !== 'recording') return { moved: false }

  // ⚠ `linked` ONLY, which is the same line `attachRecordingMeeting` draws and
  // for the same reason: an `inferred` guess stages an update for review, so
  // moving the register on one would assert what the feed is still asking
  // about. And a record kind that is not a deal (a steel deal, a lead) has
  // nowhere on a meeting to go.
  const { data: links } = await supabase
    .from('thread_links')
    .select('record_kind, record_id')
    .eq('thread_id', threadId)
    .eq('certainty', 'linked')
    .in('record_kind', ['project', 'opportunity'])

  const rows = (links ?? []) as { record_kind: string; record_id: string }[]
  if (rows.length === 0) return { moved: false, reason: 'the thread is not filed on a deal yet' }
  // Ambiguity means no move (§12). A recording legitimately names several deals
  // — 9 of 10 name two to eight — and the register holds the EVENT once, so
  // which of them it belongs to is a human's call, not a coin flip.
  if (rows.length > 1) {
    return { moved: false, reason: `the thread is filed on ${rows.length} records` }
  }

  return attachRecordingMeeting({
    gmailThreadId: thread.gmail_thread_id,
    subject: thread.subject,
    certainty: 'linked',
    recordKind: rows[0].record_kind,
    recordId: rows[0].record_id,
  })
}
