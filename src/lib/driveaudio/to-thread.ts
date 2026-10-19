/**
 * Audio dropped in a Drive folder becomes an `email_threads` row.
 *
 * ⚠ THE FOURTH SOURCE TO MAKE THIS EXACT MOVE, AND THE REASON IS UNCHANGED.
 * Summarize, cluster, stage, route, append `updates`, embed, extract
 * commitments, predecide — all eight phases read `email_threads` and not one of
 * them is about email. §12: never fork a shared pass, add a caller.
 *
 * ⚠ THE DISCRIMINATOR IS `gmail_thread_id`, PREFIXED `driveaudio:`, and the
 * VALUE after it is Drive's own file id. That id is stable across a rename and
 * across a move between folders, which is what makes it the idempotency key for
 * the whole pipeline: renaming the file after it has been read costs nothing,
 * and renaming it BEFORE the sweep runs is the cheapest filing signal there is.
 *
 * ⚠ IT CARRIES NO MODIFICATION STAMP, following `voicememo:` rather than
 * `note:`. A note is a living document, so its thread id holds its modification
 * time and an edit re-summarizes it. Audio never changes — editing an mp3 in
 * place is not a thing anybody does — so a second read would spend whisper
 * reaching an identical answer and stage a second meeting for one conversation.
 *
 * ⚠ IT IS A `recording` AND NOT A NEW `ThreadSource`. A Plaude export and an
 * iPhone voice memo are the same KIND of thing to every reader downstream — a
 * conversation somebody recorded, transcribed on this box — and they differ
 * only in how the bytes arrived. Reusing the member means no `update_source`
 * enum migration (§12: a value outside an enum fails the whole write) and no
 * new arm in `curator/evidence.ts` or `commitments/chase.ts`. What DOES need
 * an arm is the prefix list in `thread-source.ts`, which is the file whose
 * header explains what forgetting it costs.
 *
 * ⚠ ONE FILE IS ONE THREAD. Somebody pressed record and pressed stop, so the
 * unit of meaning already exists — the same judgement a memo gets, and the
 * opposite of the text layer's 6-hour sessions over an unbounded stream.
 */

import { PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'
import type { ResolvedThread } from '@/lib/integrations/gmail-search'
import type { DriveAudioRow } from './read'

export const DRIVE_AUDIO_THREAD_PREFIX = 'driveaudio:'

/** True for a thread that is audio filed in the Drive intake folder. */
export function isDriveAudioThread(gmailThreadId: string | null | undefined): boolean {
  return typeof gmailThreadId === 'string' && gmailThreadId.startsWith(DRIVE_AUDIO_THREAD_PREFIX)
}

/** The thread id for one file — stable across renames, moves and re-runs. */
export function driveAudioThreadId(fileId: string): string {
  return `${DRIVE_AUDIO_THREAD_PREFIX}${fileId}`
}

/**
 * What this recording is called, for a reader and for the router.
 *
 * ⚠ THE SUBFOLDER LEADS, AND THAT IS THE WHOLE ERGONOMIC POINT. A Plaude
 * export — like a voice memo — is named with a timestamp, which names no deal,
 * so a well-named file is a habit nobody keeps. Dropping the file into a
 * subfolder called after the deal is a gesture that survives being in a hurry,
 * and it is the same control model as nominating the folder in the first place:
 * a human filing decision, read as fact rather than guessed at.
 *
 * The folder name is not matched to a record HERE — `route-phase.ts` owns that
 * question for every source and has the aliases a human asserted. This only
 * makes sure the name is in the text that pass reads.
 */
export function driveAudioSubject(file: DriveAudioRow): string {
  const name = file.title || '(untitled recording)'
  return file.folderHint ? `${file.folderHint} — ${name}` : name
}

/**
 * Build the thread for one transcribed file.
 *
 * `transcript` is whisper's output. There is no body to fall back on — audio
 * has no text — so if there is no transcript there is no thread, and the sweep
 * refuses to store one (see ./sweep.ts).
 */
export function driveAudioToThread(
  file: DriveAudioRow,
  transcript: string,
  mailbox: string = PRIMARY_MAILBOX
): ResolvedThread {
  const threadId = driveAudioThreadId(file.fileId)
  const subject = driveAudioSubject(file)

  // The subject leads the body as well as naming the row: the summarizer and
  // the router both read `raw_markdown`, so dropping it here would throw away
  // the only metadata a recording has.
  const provenance = file.folderHint
    ? `[Recording filed in Drive under "${file.folderHint}", transcribed on this machine.]`
    : '[Recording filed in the Drive intake folder, transcribed on this machine.]'
  const body = `${subject}\n\n${provenance}\n\n${transcript}`

  return {
    fingerprint: threadId,
    mailbox,
    threadId,
    subject,
    // When the conversation HAPPENED, which for this source is a best effort
    // and says so: `recordedAt` is parsed from the file name when the name
    // carries a date and is Drive's modified time otherwise (see ./read.ts).
    // The whole pipeline reads `last_at` as when the conversation happened, and
    // a call filed under its upload time sorts above the mail that followed it.
    firstAt: file.recordedAt,
    lastAt: file.recordedAt,
    // ⚠ NO PARTICIPANTS BUT THE OWNER, AND NOT GUESSED FROM THE TRANSCRIPT. The
    // enrichment pass matches a thread's participants against `parties` as
    // fact, so a cast invented from whoever introduced themselves would be
    // asserted as having been there. Who was in the room is the recap's job,
    // where it is staged for a human (`analyzeMeetingNotes` → attendees).
    //
    // It also means an obligation in the transcript reads as internal, which is
    // right for the calls this captures and is what lets
    // `promoteInternalCommitments` put a follow-up straight on the board.
    participants: [mailbox],
    attachmentCount: 0,
    messages: [
      {
        id: threadId,
        threadId,
        // No RFC Message-ID exists; the synthetic thread id stands in, as it
        // does for a note and a memo.
        messageId: threadId,
        mailbox,
        subject,
        from: { name: 'Recording', address: mailbox },
        to: [],
        cc: [],
        receivedAt: file.recordedAt,
        bodyText: body,
        snippet: transcript.slice(0, 200),
        attachments: [],
        webLink: file.webViewLink ?? '',
      },
    ],
  }
}
