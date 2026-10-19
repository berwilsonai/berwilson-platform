/**
 * A voice memo becomes an `email_threads` row.
 *
 * The thread SHAPE — and the reasoning behind every part of it — lives in
 * `@/lib/audio/to-thread`, shared with every other recorder. Read the ⚠ block
 * there before changing anything here. What is local to a voice memo is its
 * prefix, its stable identifier and the one sentence of provenance that can
 * name a duration, because a memo is the only source that knows one.
 */

import { PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'
import type { ResolvedThread } from '@/lib/integrations/gmail-search'
import { recordingToThread } from '@/lib/audio/to-thread'
import type { MemoRow } from './read'

export const VOICEMEMO_THREAD_PREFIX = 'voicememo:'

/** True for a thread that is a recorded meeting rather than mail or a text. */
export function isVoiceMemoThread(gmailThreadId: string | null | undefined): boolean {
  return typeof gmailThreadId === 'string' && gmailThreadId.startsWith(VOICEMEMO_THREAD_PREFIX)
}

/** The thread id for one memo — stable across renames and re-runs. */
export function memoThreadId(identifier: string): string {
  return `${VOICEMEMO_THREAD_PREFIX}${identifier}`
}

/**
 * Build the thread for one transcribed memo.
 *
 * `transcript` is whisper's output. A recording has no body to fall back on,
 * so if there is no transcript there is no thread and the sweep refuses to
 * store one (see ./sweep.ts).
 */
export function memoToThread(
  memo: MemoRow,
  transcript: string,
  mailbox: string = PRIMARY_MAILBOX
): ResolvedThread {
  return recordingToThread({
    threadId: memoThreadId(memo.identifier),
    subject: memo.title || '(untitled recording)',
    provenance:
      memo.durationSeconds != null
        ? `[Recording, ${Math.round(memo.durationSeconds / 60)} min, transcribed on this machine.]`
        : '[Recording, transcribed on this machine.]',
    transcript,
    // When the recording was MADE, not when iCloud got round to syncing it.
    occurredAt: memo.createdAt,
    mailbox,
  })
}
