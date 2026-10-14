/**
 * A recorded phone call becomes a MEETING, not just a thread.
 *
 * ⚠ THE SHARED HALF MOVED OUT ON 10-14, to `meetings/record-local.ts`, when a
 * voice memo of an in-person meeting became a second transport needing exactly
 * the same recap-and-register pass. Read that file for WHY a transcript alone
 * is not enough (`meetings` had no row, so Ber AI's meeting tools could not see
 * the one real call; zero `meeting_attended` rows existed against any contact,
 * ever), for why no document is filed, and for the §11 bound on what may be
 * created without a human.
 *
 * What is left here is the only part that is genuinely about a PHONE CALL: iOS
 * writes the counterparty into the note's title, so both ends of the
 * conversation are known structurally — without a similarity score, and without
 * reading a word of the transcript. An in-person recording has no such signal,
 * which is the whole difference between the two callers.
 */

import { recordLocalRecording, localDateString } from '@/lib/meetings/record-local'
import { createAdminClient } from '@/lib/supabase/admin'

import { callCounterpartyName, resolveCallParty } from './call-party'
import type { NoteRow } from './read'

/**
 * The idempotency key for a call that came from Notes.
 *
 * ⚠ IT GOES IN `drive_file_id`, PREFIXED `note:`, AND THAT IS THE SAME MOVE THE
 * THREAD LAYER MAKES. `email_threads.gmail_thread_id` holds `note:<id>`,
 * `imessage:<chat>` and `voicememo:<id>` for exactly this reason: the column
 * that already carries a platform-wide unique index is the one that can enforce
 * "record this call once", and three tables (`meetings`,
 * `email_intake_sessions`, `documents`) key on this one. Every use of it in
 * those tables is an OPAQUE string compared for equality — nothing parses it as
 * a Drive id — so a prefixed local id costs no migration and no new index, and
 * a reader grepping `note:` finds one convention.
 *
 * It is built from Apple's `ZIDENTIFIER`, which is stable across edits. The
 * THREAD id deliberately carries the modification time instead, so an edited
 * note re-summarizes; a recording's AUDIO never changes, so re-transcribing it
 * would cost 30 seconds of whisper for an identical answer.
 */
export function callSourceRef(identifier: string): string {
  return `note:${identifier}`
}

/** Is this call already in the meeting register? Then there is nothing to do. */
export async function callAlreadyRecorded(identifier: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('meetings')
    .select('id')
    .eq('drive_file_id', callSourceRef(identifier))
    .maybeSingle()
  return Boolean(data)
}

export interface CallRecordResult {
  /** The meeting row, when one was written. */
  meetingId: string | null
  /** The staged recap awaiting a human's filing decision. */
  sessionId: string | null
  /** Who iOS says the call was with, verbatim. */
  counterparty: string | null
  /** The directory contact it resolved to, and the reason it did. */
  contact: { id: string; name: string; reason: string } | null
  /** Two contacts answered to the name, so neither was chosen (§12). */
  ambiguous: string | null
  /** Why nothing was recorded, when nothing was. Never silent. */
  skipped: string | null
}

/**
 * Record one transcribed call: recap it, register it, put it on the contact.
 *
 * ⚠ THE RECAP AND THE REGISTER NOW LIVE IN `meetings/record-local.ts`, shared
 * with the voice-memo path (10-14). What stays here is the only thing that is
 * actually about a phone call: iOS writes the counterparty into the title, so
 * both ends of the conversation are known without reading a word of it.
 *
 * `transcript` is whisper's output, not the note body — a call recording's own
 * body is 254 bytes of attachment pointer.
 */
export async function recordCallNote(
  note: NoteRow,
  transcript: string
): Promise<CallRecordResult> {
  const base: CallRecordResult = {
    meetingId: null,
    sessionId: null,
    counterparty: callCounterpartyName(note.title),
    contact: null,
    ambiguous: null,
    skipped: null,
  }

  if (!transcript.trim()) return { ...base, skipped: 'no transcript' }

  // Who it was with, from iOS's own title — the strongest evidence here.
  if (base.counterparty) {
    const resolved = await resolveCallParty(base.counterparty).catch(() => ({
      match: null,
      ambiguous: null,
    }))
    if (resolved.match) {
      base.contact = {
        id: resolved.match.party.id,
        name: resolved.match.party.full_name,
        reason: resolved.match.reason,
      }
    } else if (resolved.ambiguous) {
      base.ambiguous = resolved.ambiguous
    }
  }

  const recorded = await recordLocalRecording({
    // ⚠ THE RAW iOS TITLE, AND SAFE ONLY BECAUSE THE LEARNER REFUSES IT.
    // `source_title` is what the confirm step learns as a filing key, and "Call
    // with Eric Tuaone" names a PERSON — learning it would file every future
    // call with a colleague onto whichever deal the first one happened to
    // concern. `normalizeMeetingTitle` refuses a `Call with …` title for that
    // reason; storing the real title here keeps the row honest AND stops the
    // fallback to the model's rewritten title, which no future call can present.
    title: note.title,
    // The call happened when the note was created; `modifiedAt` moves if iOS
    // writes the transcript or the title afterwards.
    meetingDate: localDateString(note.createdAt),
    transcript,
    sourceRef: callSourceRef(note.identifier),
    // The counterparty is handed in rather than left to the model: a transcript
    // often never says a surname, and the Contacts card did.
    seedAttendees: base.counterparty ? [{ name: base.counterparty, email: null }] : [],
    partyOverrides:
      base.contact && base.counterparty
        ? [{ name: base.counterparty, partyId: base.contact.id }]
        : [],
  })

  if (recorded.skipped) return { ...base, sessionId: recorded.sessionId, skipped: recorded.skipped }
  return { ...base, meetingId: recorded.meetingId, sessionId: recorded.sessionId }
}
