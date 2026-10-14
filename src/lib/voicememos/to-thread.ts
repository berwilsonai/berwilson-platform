/**
 * A voice memo becomes an `email_threads` row, so the mail machinery reads it.
 *
 * ⚠ THE THIRD SOURCE TO MAKE THIS EXACT MOVE, AND THE REASON IS UNCHANGED.
 * Summarize, cluster, stage, route, append `updates`, embed, extract
 * commitments, predecide — all eight phases read `email_threads` and not one of
 * them is about email. A recorded meeting written as a ninth kind of source
 * would mean a ninth copy of all of it; written as a thread it is summarized,
 * filed on the deal it names, indexed for Ber AI and read for obligations on
 * the same schedule as mail, with no new code in any phase. §12 — never fork a
 * shared pass, add a caller.
 *
 * ⚠ THE DISCRIMINATOR IS `gmail_thread_id`, PREFIXED `voicememo:` — the
 * structural column that can never hold a Gmail id, exactly as `imessage:` and
 * `note:` use it. `mailbox` is the owner's real address on purpose: this memo
 * IS Richard's, so attribution, the commitment side filter and the chase pass
 * all key on it finding a real team member.
 *
 * ⚠ AND THE ID CARRIES NO MODIFICATION STAMP, WHICH IS THE ONE PLACE THIS
 * DIFFERS FROM A NOTE. `noteToThread` puts the note's modification time in the
 * thread id so an EDITED note re-summarizes — a note is a living document and a
 * stale summary of a rewritten one is worse than two rows. A recording's audio
 * never changes. What a human can change is the NAME, and a rename must not
 * cost another 30 seconds of whisper and a second row for the same meeting. So
 * the id is the recording's stable identifier alone, and a rename after
 * ingestion changes nothing here: it was only ever the filing key for a memo
 * not yet read. (Rename BEFORE the sweep runs and it files itself; rename after,
 * and the deal is attached by a human in /decide, which is the same tap it would
 * have been.)
 *
 * ⚠ ONE MEMO IS ONE THREAD — the same judgement `noteToThread` makes and the
 * opposite of the text layer's. A chat is an unbounded stream and had to be cut
 * into 6-hour sessions to become a unit of meaning; a memo is already the unit,
 * because somebody pressed record and pressed stop.
 */

import { PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'
import type { ResolvedThread } from '@/lib/integrations/gmail-search'
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
 * `transcript` is whisper's output. The memo's own body is nothing at all — a
 * recording has no text — so unlike a note there is no stub to replace and no
 * attachment sentence to write: if there is no transcript there is no thread,
 * and the sweep refuses to store one (see ./sweep.ts).
 */
export function memoToThread(
  memo: MemoRow,
  transcript: string,
  mailbox: string = PRIMARY_MAILBOX
): ResolvedThread {
  const threadId = memoThreadId(memo.identifier)
  const subject = memo.title || '(untitled recording)'

  // The title leads the body as well as naming the row. The summarizer and the
  // router both read `raw_markdown`, and a memo named after the deal is the
  // cheapest filing signal there is — dropping it from the text would throw
  // away the one piece of metadata a recording has.
  const lengthLine =
    memo.durationSeconds != null
      ? `[Recording, ${Math.round(memo.durationSeconds / 60)} min, transcribed on this machine.]`
      : '[Recording, transcribed on this machine.]'
  const body = `${subject}\n\n${lengthLine}\n\n${transcript}`

  return {
    fingerprint: threadId,
    mailbox,
    threadId,
    subject,
    // When the recording was MADE, not when iCloud got round to syncing it: the
    // whole pipeline treats `last_at` as when the conversation happened, and a
    // meeting that files itself onto a deal with the sync time would sort above
    // correspondence that came after it.
    firstAt: memo.createdAt,
    lastAt: memo.createdAt,
    // ⚠ NO PARTICIPANTS BUT THE OWNER, AND NOT GUESSED FROM THE TRANSCRIPT. The
    // enrichment pass matches a thread's participants against `parties`, and a
    // cast invented from whoever introduced themselves on the recording would
    // be matched as fact. Who was in the room is the recap's job, where it is
    // staged for a human (`analyzeMeetingNotes` → attendees), not the thread's.
    //
    // It also means an obligation in the transcript reads as internal, which is
    // correct for the meetings this captures — two executives in a room — and
    // is what lets `promoteInternalCommitments` put a follow-up on the board.
    participants: [mailbox],
    attachmentCount: 0,
    messages: [
      {
        id: threadId,
        threadId,
        // A memo has no RFC Message-ID; the synthetic thread id stands in, as
        // it does for a note.
        messageId: threadId,
        mailbox,
        subject,
        from: { name: 'Recording', address: mailbox },
        to: [],
        cc: [],
        receivedAt: memo.createdAt,
        bodyText: body,
        snippet: transcript.slice(0, 200),
        attachments: [],
        webLink: '',
      },
    ],
  }
}
