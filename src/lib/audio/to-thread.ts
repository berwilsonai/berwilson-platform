/**
 * A recording becomes an `email_threads` row, so the mail machinery reads it.
 *
 * ⚠ WHY A RECORDING IS A THREAD AT ALL. Summarize, cluster, stage, route,
 * append `updates`, embed, extract commitments, predecide — all eight phases
 * read `email_threads` and not one of them is about email. A recording written
 * as its own kind of source would mean another copy of all of it; written as a
 * thread it is summarized, filed on the deal it names, indexed for Ber AI and
 * read for obligations on the same schedule as mail, with no new code in any
 * phase. §12 — never fork a shared pass, add a caller.
 *
 * ⚠ AND WHY THERE IS ONE OF THESE RATHER THAN ONE PER RECORDER. Voice memos
 * and Drive audio each had their own copy of the function below, written three
 * days apart, differing in the thread-id prefix and one sentence of provenance
 * — everything load-bearing was identical, including the two ⚠ comments that
 * matter most. Measured 2026-10-19. The next recorder (a Zoom export, a
 * dictaphone, the browser's own voice button) is a `RecordingThreadInput`, not
 * a third copy.
 *
 * ⚠ THE DISCRIMINATOR IS `gmail_thread_id`, PREFIXED PER SOURCE — the
 * structural column that can never hold a Gmail id, exactly as `imessage:` and
 * `note:` use it. `mailbox` is the owner's real address on purpose: the
 * recording IS theirs, so attribution, the commitment side filter and the
 * chase pass all key on it finding a real team member.
 *
 * ⚠ AND THE ID CARRIES NO MODIFICATION STAMP, UNLIKE A NOTE. `noteToThread`
 * puts the note's modification time in the thread id so an EDITED note
 * re-summarizes — a note is a living document. A recording's audio never
 * changes; what a human can change is the NAME, and a rename must not cost
 * another 30 seconds of whisper and a second row for the same meeting. So the
 * id is the recording's stable identifier alone. (Rename BEFORE the sweep runs
 * and it files itself; rename after, and the deal is attached by a human in
 * /decide — the same tap it would have been.)
 *
 * ⚠ ONE RECORDING IS ONE THREAD, the opposite of the text layer's judgement. A
 * chat is an unbounded stream and had to be cut into 6-hour sessions to become
 * a unit of meaning; a recording is already the unit, because somebody pressed
 * record and pressed stop.
 */
import { PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'
import type { ResolvedThread } from '@/lib/integrations/gmail-search'

export interface RecordingThreadInput {
  /** `<prefix>:<stable id>` — see the ⚠ on the discriminator above. */
  threadId: string
  /** Names the row, and leads the body for the summarizer and the router. */
  subject: string
  /**
   * One bracketed sentence under the subject saying what this is and where it
   * came from. ⚠ §12: every arm of a provenance line must be true for the
   * source that writes it — a memo's length, a Drive file's folder.
   */
  provenance: string
  /** Whisper's output, non-empty. No transcript means no thread. */
  transcript: string
  /**
   * When the conversation HAPPENED, never when it synced or uploaded. The whole
   * pipeline reads `last_at` as that, and a call filed under its upload time
   * sorts above the mail that followed it.
   */
  occurredAt: string
  /** The owner's real mailbox. Defaults to the primary. */
  mailbox?: string
  /** A link back to the source, where one exists. */
  webLink?: string | null
}

export function recordingToThread(input: RecordingThreadInput): ResolvedThread {
  const mailbox = input.mailbox ?? PRIMARY_MAILBOX
  const { threadId, subject, transcript, occurredAt } = input
  const body = `${subject}\n\n${input.provenance}\n\n${transcript}`

  return {
    fingerprint: threadId,
    mailbox,
    threadId,
    subject,
    firstAt: occurredAt,
    lastAt: occurredAt,
    // ⚠ NO PARTICIPANTS BUT THE OWNER, AND NEVER GUESSED FROM THE TRANSCRIPT.
    // The enrichment pass matches a thread's participants against `parties` as
    // fact, so a cast invented from whoever introduced themselves would be
    // asserted as having been in the room. Who attended is the recap's job,
    // where it is staged for a human (`analyzeMeetingNotes` → attendees).
    //
    // It also means an obligation in the transcript reads as internal, which
    // is right for the calls this captures and is what lets
    // `promoteInternalCommitments` put a follow-up straight on the board.
    participants: [mailbox],
    attachmentCount: 0,
    messages: [
      {
        id: threadId,
        threadId,
        // No RFC Message-ID exists for a recording; the synthetic thread id
        // stands in, as it does for a note.
        messageId: threadId,
        mailbox,
        subject,
        from: { name: 'Recording', address: mailbox },
        to: [],
        cc: [],
        receivedAt: occurredAt,
        bodyText: body,
        snippet: transcript.slice(0, 200),
        attachments: [],
        webLink: input.webLink ?? '',
      },
    ],
  }
}
