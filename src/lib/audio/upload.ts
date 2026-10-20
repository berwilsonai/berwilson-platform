/**
 * A recording uploaded onto a record by a person — the door where the filing is
 * never in doubt.
 *
 * Richard's direction, 2026-10-19: *"I am only going to drop the file in that
 * general folder without any labels on it. You will have to deduce from the
 * transcript where it belongs. If you want to add an upload MP3 button on the
 * 'update' area of projects and opportunities, we can have that be a fallback
 * to make sure our recording associates to the appropriate record."*
 *
 * So this is the fallback for when deduction fails, and its whole value is that
 * it CANNOT fail: the record is a parameter, written as a `linked` link before
 * routing runs, so `routeThreads` finds the thread already filed and does not
 * guess. §12 — a container a human put something into is an ASSERTION, with an
 * alias's standing, not a description to be matched.
 *
 * ⚠ IT IS THE SAME PASS, NOT A SMALLER ONE. The existing meeting-tab upload
 * (`runMeetingTranscription`) transcribes, writes a summary if the field is
 * blank, and files the transcript as a document — and stops. No thread, so no
 * passages in the obligation ledger; no commitments; no tasks; nothing on the
 * record's feed. That is §12 twice over: two doors for one artifact where only
 * one owns an index, and *"a destination that does not carry what creating
 * carries reads as losing the work"*. This path runs the eight phases every
 * other recording gets, through `runRecordingPhases`, and then registers the
 * meeting exactly as the sweeps do.
 *
 * ⚠ THE WORK/NOISE GATE IS DELIBERATELY SKIPPED. The voice-memo sweep reads
 * every memo on the phone and must judge which are private; a file a person
 * chose, and attached to a named deal, has already been judged by the only
 * party entitled to. Running the classifier here would mean a human's filing
 * decision could be overruled by a model, and a `noise` verdict DISCARDS the
 * transcript.
 *
 * ⚠ THE AUDIO IS NOT KEPT. The transcript is (on the thread, on the meeting,
 * and as indexed passages) — the mp3 is not, because `documents.project_id`
 * has no opportunity sibling (an opportunity's files live in
 * `opportunity_documents`), and storing hundreds of megabytes per call on a
 * 36GB box that already swaps buys an archive Drive is already holding. Keep
 * the file wherever you exported it from.
 */

import { transcribeAudio, whisperEnabled } from '@/lib/ai/whisper'
import { recordingToThread } from '@/lib/audio/to-thread'
import { uploadThreadId } from '@/lib/audio/upload-ref'
import { runRecordingPhases } from '@/lib/audio/phases'
import { promoteAndAlert, type PromotionReport } from '@/lib/audio/promote'
import { storeFetchedThreads } from '@/lib/email-sweep/fetch-phase'
import { summarizePending } from '@/lib/email-sweep/summarize-phase'
import { sweepDb } from '@/lib/email-sweep/db'
import { fileMeetingFromThreadLinks } from '@/lib/meetings/attach-recording'
import { localDateString, recordLocalRecording } from '@/lib/meetings/record-local'
import { type RecordingPhaseCounts, emptyPhaseCounts } from '@/lib/audio/phases'

// Re-exported from the leaf module so callers have one import, while
// `attach-recording` can reach the predicate without a cycle through this file.
export { UPLOAD_THREAD_PREFIX, isUploadThread, uploadThreadId } from '@/lib/audio/upload-ref'

export interface UploadTarget {
  kind: 'project' | 'opportunity'
  id: string
  name: string
}

export interface UploadRecordingInput {
  bytes: Buffer
  /** The file's own name, used for the title when none is given. */
  fileName: string
  /** The record the person chose. Never matched, never second-guessed. */
  target: UploadTarget
  /** What to call it. Defaults to the file name without its extension. */
  title?: string | null
  /** When the conversation HAPPENED, 'YYYY-MM-DD'. Defaults to today. */
  occurredOn?: string | null
  /** Whose recording this is. Defaults to the primary mailbox. */
  mailbox?: string
  /** Who uploaded it, for the provenance line a person reads later. */
  uploadedBy?: string | null
}

export interface UploadRecordingResult {
  ok: boolean
  /** Why nothing happened, when nothing did. Never silent. */
  error: string | null
  threadId: string | null
  meetingId: string | null
  /** Characters of transcript, so a near-empty recording is visible. */
  transcriptChars: number
  phases: RecordingPhaseCounts
  promotion: PromotionReport | null
  notes: string[]
}

/** Whisper's own floor: shorter than this is somebody testing the button. */
const MIN_TRANSCRIPT_CHARS = Number(process.env.UPLOAD_MIN_TRANSCRIPT_CHARS ?? 40)

function titleFrom(input: UploadRecordingInput): string {
  const given = input.title?.trim()
  if (given) return given
  const stem = input.fileName.replace(/\.[a-z0-9]{1,5}$/i, '').trim()
  return stem || 'Uploaded recording'
}

/**
 * Transcribe one uploaded recording and give it the full treatment, filed on
 * the record the uploader named.
 *
 * Returns rather than throws: the caller is an HTTP route and every failure
 * here has a sentence a person can act on.
 */
export async function ingestUploadedRecording(
  input: UploadRecordingInput
): Promise<UploadRecordingResult> {
  const result: UploadRecordingResult = {
    ok: false,
    error: null,
    threadId: null,
    meetingId: null,
    transcriptChars: 0,
    phases: emptyPhaseCounts(),
    promotion: null,
    notes: [],
  }

  if (!whisperEnabled()) {
    // ⚠ BOTH THE BINARY AND THE MODEL ARE STAT'D — §7 records that a missing
    // file here is otherwise a silent outage.
    result.error =
      'Transcription is not available on this server (WHISPER_BIN / WHISPER_MODEL). ' +
      'The file was not stored, so nothing is half-done — try again once it is configured.'
    return result
  }

  const title = titleFrom(input)
  const occurredOn = input.occurredOn?.trim() || localDateString(new Date().toISOString())

  // ── 1. Transcribe ─────────────────────────────────────────────────────────
  let transcript: string
  try {
    transcript = await transcribeAudio(input.bytes, input.fileName)
  } catch (err) {
    result.error = `Transcription failed: ${err instanceof Error ? err.message : String(err)}`
    return result
  }
  transcript = transcript.trim()
  result.transcriptChars = transcript.length
  if (transcript.length < MIN_TRANSCRIPT_CHARS) {
    result.error =
      transcript.length === 0
        ? 'Whisper produced no text — check the file actually contains speech.'
        : `Only ${transcript.length} characters of speech were found, which is too little to file.`
    return result
  }

  // ── 2. The words become a thread, which is what reaches retrieval ─────────
  //
  // The fingerprint is random rather than derived from the bytes, deliberately:
  // a hash would make re-uploading the same file a no-op, and on THIS path a
  // re-upload is how a person corrects a wrong record. (A Drive drop is the
  // opposite — there the file id is the guard against reading it twice.)
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const fingerprint = uploadThreadId(token)
  const who = input.uploadedBy?.trim()
  const thread = recordingToThread({
    threadId: fingerprint,
    subject: title,
    provenance:
      `[Recording uploaded onto ${input.target.name}${who ? ` by ${who}` : ''} and transcribed on this ` +
      `machine. Filed on that record because a person chose it, not by matching. ` +
      `Whisper writes no speaker labels, so who said what is only as clear as the audio.]`,
    transcript,
    occurredAt: `${occurredOn}T12:00:00.000Z`,
    mailbox: input.mailbox,
  })

  try {
    await storeFetchedThreads([thread], 'deal')
  } catch (err) {
    result.error = `The transcript could not be stored: ${err instanceof Error ? err.message : String(err)}`
    return result
  }

  const db = sweepDb()
  const { data: row, error: readErr } = await db
    .from('email_threads')
    .select('id')
    .eq('gmail_thread_id', fingerprint)
    .maybeSingle()
  if (readErr || !row) {
    result.error = 'The transcript was stored but could not be read back by id.'
    return result
  }
  const threadId = (row as { id: string }).id
  result.threadId = threadId

  // ── 3. Summarize, then the shared phases with the record ASSERTED ─────────
  try {
    await summarizePending({ threadIds: [threadId], maxThreads: 1 })
  } catch (err) {
    result.notes.push(
      `The summary pass failed (${err instanceof Error ? err.message : String(err)}); the ` +
        `transcript is stored and searchable, and the next sweep will summarize it.`
    )
  }

  const phased = await runRecordingPhases({
    threadIds: [threadId],
    assertions: [
      {
        threadId,
        kind: input.target.kind,
        recordId: input.target.id,
        reason: `uploaded onto ${input.target.name}${who ? ` by ${who}` : ''}`,
      },
    ],
    // No advice: on this path an unfiled thread is a fault, not a habit to fix.
  })
  result.phases = phased.counts
  result.notes.push(...phased.notes)

  // ── 4. And it becomes a MEETING, as every other recording does ────────────
  const recorded = await recordLocalRecording({
    title,
    meetingDate: occurredOn,
    transcript,
    sourceRef: fingerprint,
    // No seeded attendees: an uploaded recording names nobody structurally, so
    // who was in the room is whatever the transcript says and the recap stages
    // it for a human rather than asserting it.
  }).catch((err) => {
    console.error('[audio/upload] meeting record failed:', err)
    return null
  })

  if (!recorded || recorded.skipped) {
    result.notes.push(
      `Transcribed and filed on ${input.target.name}, but not registered as a meeting — ` +
        `${recorded?.skipped ?? 'unknown'}.`
    )
  } else {
    result.meetingId = recorded.meetingId
    // ⚠ THE REGISTER IS WRITTEN LAST, so `applyThreadUpdates` had no row to
    // move when it visited the link — the hole that left both voice memos on
    // the box `unfiled` under a correctly `linked` thread (10-18). Asked from
    // this side, where the change just happened.
    const moved = await fileMeetingFromThreadLinks(threadId).catch(() => null)
    if (moved?.moved) result.phases.meetingsFiled += 1

    // The same promotion gate every other door runs. The chosen record exists,
    // so gate 1 refuses it — but a call filed on Steelton can still be first
    // contact on something new, and that is the case this is here for.
    result.promotion = await promoteAndAlert({
      extraction: recorded.extraction,
      sourceRef: fingerprint,
      recordedOn: occurredOn,
      sourceTitle: title,
      mailboxes: input.mailbox ? [input.mailbox] : undefined,
    })
    result.notes.push(...result.promotion.notes)
    for (const n of result.promotion.alert?.notes ?? []) result.notes.push(n)
  }

  result.ok = true
  return result
}
