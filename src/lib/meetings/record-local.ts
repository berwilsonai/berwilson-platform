/**
 * A recording made on this hardware becomes a MEETING, not just a thread.
 *
 * ⚠ WHAT A THREAD ALONE LEAVES OUT, MEASURED ON THE LIVE DATABASE 2026-10-14.
 * The 10-12 session got the hard half right for an iPhone call recording —
 * whisper transcribes it on-box and the transcript becomes an `email_threads`
 * row that inherits all eight mail phases. Reading the result showed three
 * things missing, and none of them was about the transcript:
 *
 *   - **`meetings` had no row**, so `search_meetings` and
 *     `get_meeting_content` — the tools Ber AI reaches for when asked what was
 *     said on a call — could not see it at all. The Meet importer writes that
 *     row; a local recording had no such door;
 *   - **nothing reached the contacts.** `updates.mentioned_parties` came back
 *     `[]` and `syncAttendeeActivity` was only ever called by the hand-typed
 *     form. Zero `meeting_attended` rows existed against any contact, for any
 *     meeting, ever (7 meetings and 19 links were backfilled);
 *   - the recap, and so the follow-up tasks and the filing decision, never
 *     existed for a reviewer to confirm.
 *
 * So this is the adapter that hands a local recording to the machinery a Meet
 * recording already goes through — `analyzeMeetingNotes` for the recap,
 * `upsertMeetingFromImport` for the register, the review queue for the filing
 * decision. §12: never fork a shared pass, add a caller.
 *
 * ⚠ IT IS SHARED BY TWO TRANSPORTS AND WILL BE SHARED BY MORE. An iPhone call
 * recording arrives through Apple Notes; a voice memo of an in-person meeting
 * arrives through the Voice Memos store; audio dropped in Drive and an in-app
 * recorder are both specified. They differ in how the audio is found and in
 * what is known about who was there — nothing else — so everything after
 * "here is a transcript and when it happened" lives here, once.
 *
 * ⚠ IT DELIBERATELY DOES NOT FILE A DOCUMENT. `fileMeetingDocument` is the one
 * step of the Meet path this skips, because the transcript is ALREADY indexed —
 * it arrived as a thread, and `thread_chunks` holds it. Filing it again would
 * put the same words in the curated `chunks` index to compete with themselves
 * for the same question, which is exactly why `upsertMeetingFromImport` sets
 * `index_ai: false` on its own row.
 *
 * ⚠ AND IT NEVER CREATES A PERSON. §11 is intact: an attendee is linked only
 * where the caller is SURE (a contact that already answers to a name iOS wrote,
 * or the owner of the mailbox the recording is attributed to), the recap stages
 * as `pending`, and attaching the recording to a deal stays a human act — or
 * the thread router's, which has its own certainty rule. Nothing here invents a
 * party, a project or a task.
 */

import { analyzeMeetingNotes, type SeedAttendee } from '@/lib/email-ingestion/analyze-meeting'
import type { MeetingIntakeExtraction } from '@/lib/ai/prompts/meeting-intake'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'
import { upsertMeetingFromImport } from '@/lib/meetings/record'
import { createAdminClient } from '@/lib/supabase/admin'
import { PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'

export interface LocalRecordingInput {
  /**
   * The title as it exists OUTSIDE the platform — iOS's "Call with …", or the
   * name on the voice memo.
   *
   * ⚠ STORED AS `source_title`, WHICH IS THE FILING KEY AND NOT THE DISPLAY
   * NAME. The model rewrites titles ("Ber Wilson / Zenthium" came back as
   * "Steelton & Riverdale Site Reviews & Power Capacity Analysis"), and both
   * are wanted: the rewrite is what a human scans in a queue, this is the
   * string the NEXT recording in the series will arrive under, so it is what
   * meeting-title learning stores. See the 20261008000004 migration.
   */
  title: string
  /** 'YYYY-MM-DD' local — when the conversation happened. */
  meetingDate: string
  /** Whisper's output. The caller has already refused an empty one. */
  transcript: string
  /**
   * The platform-wide idempotency key: `note:<id>` or `voicememo:<id>`.
   *
   * ⚠ IT GOES IN `drive_file_id` AND NOTHING PARSES IT AS A DRIVE ID. That
   * column already carries a platform-wide unique index, which is what can
   * enforce "record this conversation once" across three tables (`meetings`,
   * `email_intake_sessions`, `documents`). Every use of it in those tables is
   * an OPAQUE equality comparison, so a prefixed local id costs no migration
   * and no new index — and a reader grepping the prefix finds one convention.
   */
  sourceRef: string
  /**
   * People known before the model reads a word — handed in rather than left to
   * the transcript, which often never says a surname.
   */
  seedAttendees?: SeedAttendee[]
  /** Attendee name → `parties.id`, for links the caller is certain of. */
  partyOverrides?: { name: string; partyId: string }[]
  /** Whose recording this is. Defaults to the primary mailbox's owner. */
  mailbox?: string
}

export interface LocalRecordingResult {
  /** The meeting row, when one was written. */
  meetingId: string | null
  /** The staged recap awaiting a human's filing decision. */
  sessionId: string | null
  /** Why nothing was recorded, when nothing was. Never silent. */
  skipped: string | null
  /**
   * The recap itself, so a caller can act on it without a second model call.
   *
   * Carried for `promoteRecordingRecords` (src/lib/records/from-recording.ts),
   * which needs the per-record `discussion` paragraphs and the dated tasks this
   * pass has already paid for. Re-reading them off the staged session would be
   * a query for data that is in hand, and re-asking the model would be a
   * summary of a summary. Null whenever nothing was staged.
   */
  extraction: MeetingIntakeExtraction | null
}

/**
 * Recap one transcribed recording, register it, and link who we are sure of.
 */
export async function recordLocalRecording(
  input: LocalRecordingInput
): Promise<LocalRecordingResult> {
  if (!input.transcript.trim()) return { meetingId: null, sessionId: null, skipped: 'no transcript', extraction: null }

  let staged
  try {
    staged = await analyzeMeetingNotes({
      rawText: input.transcript,
      title: input.title,
      meetingDate: input.meetingDate,
      userId: SYSTEM_USER_ID,
      seedAttendees: input.seedAttendees ?? [],
      driveFileId: input.sourceRef,
      sourceTitle: input.title,
      retainText: input.transcript,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // The unique index on `drive_file_id` is the real guard against two runs
    // staging one recording. Losing that race is a no-op, not a failure.
    if (msg.includes('23505') || msg.includes('drive_file_id')) {
      return { meetingId: null, sessionId: null, skipped: 'already staged by an earlier run', extraction: null }
    }
    return { meetingId: null, sessionId: null, skipped: `recap failed: ${msg}`, extraction: null }
  }

  const extraction = staged.extraction

  const meeting = await upsertMeetingFromImport({
    // The model's rewrite is what a reader scans in a list; the outside world's
    // title is kept on the session as `source_title`.
    title: extraction.title ?? input.title,
    meetingDate: extraction.meeting_date ?? input.meetingDate,
    summary: extraction.summary || null,
    minutes: extraction.minutes,
    decisions: extraction.decisions,
    attendees: extraction.attendees,
    transcript: input.transcript,
    driveFileId: input.sourceRef,
    // Unfiled on purpose. The thread this same recording produced is routed by
    // `route-phase.ts` under its own certainty rule, and
    // `attachRecordingMeeting` moves the row when that produces a `linked`
    // answer.
    target: null,
    partyMatches: staged.party_matches,
    partyOverrides: await withOwner(input.partyOverrides ?? [], input.mailbox),
  }).catch((err) => {
    console.error('[meetings/record-local] meeting record failed:', err)
    return null
  })

  if (!meeting) {
    return {
      meetingId: null,
      sessionId: staged.session_id,
      skipped: 'the meeting record could not be written',
      extraction,
    }
  }
  return { meetingId: meeting.id, sessionId: staged.session_id, skipped: null, extraction }
}

/**
 * Add the executive whose device recorded it to the links the caller is sure of.
 *
 * Whoever pressed record was in the room, which is more than the model can say
 * — it reports whoever introduced themselves. Non-fatal: a failure costs one
 * attendee link, not the record.
 */
async function withOwner(
  overrides: { name: string; partyId: string }[],
  mailbox: string = PRIMARY_MAILBOX
): Promise<{ name: string; partyId: string }[]> {
  const out = [...overrides]
  try {
    const { data } = await createAdminClient()
      .from('team_members')
      .select('name, party_id')
      .eq('email', mailbox)
      .maybeSingle()
    if (data?.party_id && data.name) out.push({ name: data.name, partyId: data.party_id })
  } catch {
    /* one attendee link, never the record */
  }
  return out
}

/** 'YYYY-MM-DD' in local time — never `new Date('YYYY-MM-DD')` (§ meetings). */
export function localDateString(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
