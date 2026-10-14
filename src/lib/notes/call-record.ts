/**
 * A recorded phone call becomes a MEETING, not just a thread.
 *
 * ⚠ WHY THIS EXISTS, MEASURED ON THE ONE REAL CALL IN THE CORPUS. The 10-12
 * session got the hard half right — iOS titles the note, whisper transcribes it
 * on-box in 29.7s, and the transcript becomes an `email_threads` row that
 * inherits all eight mail phases. Reading the live result on 10-14 showed what
 * that leaves out:
 *
 *   - the Helper project's feed said **"Email — Call with Eric Tuaone"**, from
 *     `apply-phase.ts`, which stamped `source: 'email'` on anything that was
 *     not a text (fixed by migration 20261014000001);
 *   - **`meetings` had no row for it**, so `search_meetings` and
 *     `get_meeting_content` — the tools Ber AI reaches for when asked what was
 *     said on a call — could not see it at all. The Meet importer writes that
 *     row; the phone call had no such door;
 *   - **nothing reached the contact.** `Eric Tuaone` was in the title, unused;
 *     `updates.mentioned_parties` came back `[]`; and `syncAttendeeActivity`
 *     was only ever called by the hand-typed form. Zero `meeting_attended` rows
 *     existed against any contact, for any meeting, ever.
 *
 * So this is the adapter that hands a recorded call to the machinery a Meet
 * recording already goes through — `analyzeMeetingNotes` for the recap,
 * `upsertMeetingFromImport` for the register, the review queue for the filing
 * decision. §12: never fork a shared pass, add a caller.
 *
 * ⚠ IT DELIBERATELY DOES NOT FILE A DOCUMENT. `fileMeetingDocument` is the one
 * step of the Meet path this skips, because the transcript is ALREADY indexed —
 * it arrived as a thread, and `thread_chunks` holds it. Filing it again would
 * put the same words in the curated `chunks` index to compete with themselves
 * for the same question, which is exactly why `upsertMeetingFromImport` sets
 * `index_ai: false` on its own row.
 *
 * ⚠ AND IT NEVER CREATES A PERSON. §11 is intact: the counterparty is linked
 * only if a contact already answers to that name, the recap stages as `pending`,
 * and attaching the call to a deal stays a human act (or the thread router's,
 * which has its own certainty rule). Nothing here invents a party, a project or
 * a task.
 */

import { analyzeMeetingNotes } from '@/lib/email-ingestion/analyze-meeting'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'
import { upsertMeetingFromImport } from '@/lib/meetings/record'
import { createAdminClient } from '@/lib/supabase/admin'
import { PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'

import { callCounterpartyName, resolveCallParty } from './call-party'
import type { NoteRow } from './read'

/**
 * The idempotency key for a call that came from Notes.
 *
 * ⚠ IT GOES IN `drive_file_id`, PREFIXED `note:`, AND THAT IS THE SAME MOVE THE
 * THREAD LAYER MAKES. `email_threads.gmail_thread_id` holds `note:<id>` and
 * `imessage:<chat>` for exactly this reason: the column that already carries a
 * platform-wide unique index is the one that can enforce "record this call once",
 * and three tables (`meetings`, `email_intake_sessions`, `documents`) key on this
 * one. Every use of it in those tables is an OPAQUE string compared for equality
 * — nothing parses it as a Drive id — so a prefixed local id costs no migration
 * and no new index, and a reader grepping `note:` finds one convention.
 *
 * It is built from Apple's `ZIDENTIFIER`, which is stable across edits. The
 * thread id deliberately carries the modification time instead, so an edited
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

  // The call happened when the note was created; `modifiedAt` moves if iOS
  // writes the transcript or the title afterwards.
  const meetingDate = localDateString(note.createdAt)
  const sourceRef = callSourceRef(note.identifier)

  let staged
  try {
    staged = await analyzeMeetingNotes({
      rawText: transcript,
      title: note.title,
      meetingDate,
      userId: SYSTEM_USER_ID,
      // The counterparty is handed in rather than left to the model: a
      // transcript often never says a surname, and the Contacts card did.
      seedAttendees: base.counterparty
        ? [{ name: base.counterparty, email: null }]
        : [],
      driveFileId: sourceRef,
      // ⚠ TRUE, AND SAFE ONLY BECAUSE THE LEARNER REFUSES IT. `source_title` is
      // what the confirm step learns as a filing key, and "Call with Eric
      // Tuaone" names a PERSON — learning it would file every future call with
      // a colleague onto whichever deal the first one happened to concern.
      // `normalizeMeetingTitle` refuses a `Call with …` title for that reason;
      // storing the real title here keeps the row honest AND stops the fallback
      // to the model's rewritten title, which no future call can present.
      sourceTitle: note.title,
      retainText: transcript,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // The unique index on `drive_file_id` is the real guard against two runs
    // staging one call. Losing that race is a no-op, not a failure.
    if (msg.includes('23505') || msg.includes('drive_file_id')) {
      return { ...base, skipped: 'already staged by an earlier run' }
    }
    return { ...base, skipped: `recap failed: ${msg}` }
  }

  const extraction = staged.extraction
  base.sessionId = staged.session_id

  const meeting = await upsertMeetingFromImport({
    // The model's rewrite is what a reader scans in a list; iOS's title is kept
    // on the session as `source_title` (§ the 20261008000004 migration).
    title: extraction.title ?? note.title,
    meetingDate: extraction.meeting_date ?? meetingDate,
    summary: extraction.summary || null,
    minutes: extraction.minutes,
    decisions: extraction.decisions,
    attendees: extraction.attendees,
    transcript,
    driveFileId: sourceRef,
    // Unfiled on purpose. The thread this same call produced is routed by
    // `route-phase.ts` under its own certainty rule, and `attachCallMeeting`
    // moves the row when that produces a `linked` answer.
    target: null,
    partyMatches: staged.party_matches,
    partyOverrides: await callAttendeeLinks(base),
  }).catch((err) => {
    console.error('[notes/call] meeting record failed:', err)
    return null
  })

  if (!meeting) return { ...base, skipped: 'the meeting record could not be written' }
  return { ...base, meetingId: meeting.id }
}

/**
 * The attendee links this module is sure of: the contact the title named, and
 * the executive whose phone recorded it.
 *
 * Both ends of a phone call are known without reading a word of it, which is
 * more than the model can say — it reports whoever introduced themselves.
 */
async function callAttendeeLinks(
  result: CallRecordResult
): Promise<{ name: string; partyId: string }[]> {
  const out: { name: string; partyId: string }[] = []
  if (result.contact && result.counterparty) {
    out.push({ name: result.counterparty, partyId: result.contact.id })
  }

  // The owner of the mailbox these notes are attributed to — the same mailbox
  // `noteToThread` stamps on the thread, so attribution agrees across both.
  try {
    const { data } = await createAdminClient()
      .from('team_members')
      .select('name, party_id')
      .eq('email', PRIMARY_MAILBOX)
      .maybeSingle()
    if (data?.party_id && data.name) out.push({ name: data.name, partyId: data.party_id })
  } catch {
    // Non-fatal: it costs one attendee link, not the record.
  }
  return out
}

/** 'YYYY-MM-DD' in local time — never `new Date('YYYY-MM-DD')` (§ meetings). */
function localDateString(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
