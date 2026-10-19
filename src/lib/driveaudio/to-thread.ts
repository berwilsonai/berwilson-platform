/**
 * A recording filed in the nominated Drive folder becomes an `email_threads` row.
 *
 * The thread SHAPE — and the reasoning behind every part of it — lives in
 * `@/lib/audio/to-thread`, shared with every other recorder. Read the ⚠ block
 * there before changing anything here. What is local to this source is its
 * prefix, the Drive file id, and the SUBFOLDER in the subject.
 */

import { PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'
import type { ResolvedThread } from '@/lib/integrations/gmail-search'
import { recordingToThread } from '@/lib/audio/to-thread'
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
 * `transcript` is whisper's output. Audio has no body to fall back on, so if
 * there is no transcript there is no thread and the sweep refuses to store one
 * (see ./sweep.ts).
 */
export function driveAudioToThread(
  file: DriveAudioRow,
  transcript: string,
  mailbox: string = PRIMARY_MAILBOX
): ResolvedThread {
  return recordingToThread({
    threadId: driveAudioThreadId(file.fileId),
    subject: driveAudioSubject(file),
    // ⚠ The folder is named in the text because the ROUTER reads the text, and
    // a folder a human dragged a file into is the only metadata this source
    // carries. `route-phase.ts` owns the matching.
    provenance: file.folderHint
      ? `[Recording filed in Drive under "${file.folderHint}", transcribed on this machine.]`
      : '[Recording filed in the Drive intake folder, transcribed on this machine.]',
    transcript,
    // Best effort and it says so: parsed from the file name when the name
    // carries a date, Drive's modified time otherwise (see ./read.ts).
    occurredAt: file.recordedAt,
    mailbox,
    webLink: file.webViewLink,
  })
}
