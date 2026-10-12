/**
 * A note becomes an `email_threads` row, so the mail machinery reads it.
 *
 * ⚠ THE SAME MOVE THE TEXT SWEEP MADE, FOR THE SAME REASON. Summarize, route,
 * append `updates`, embed, extract commitments, predecide — all eight phases
 * read `email_threads` and none of them is about email. Writing notes as a
 * ninth kind of source would mean a ninth copy of all of it; writing them as
 * threads means a note about the Alaska offer is summarized, filed on the
 * record, indexed for Ber AI and read for obligations the same night, with no
 * new code in any of those phases.
 *
 * ⚠ THE DISCRIMINATOR IS `gmail_thread_id`, PREFIXED `note:` — the structural
 * column that can never hold a Gmail id, exactly as the text layer uses
 * `imessage:`. `mailbox` is set to the owner's real mailbox on purpose: these
 * notes ARE Richard's, so attribution, the commitment filter and the chase pass
 * all key on it finding a real team member. §12 — key a guard on the structural
 * thing, not a display string, including one of ours.
 *
 * ⚠ ONE NOTE IS ONE THREAD, which is NOT how texts work. A chat is a stream and
 * had to be cut into 6-hour sessions to become a unit of meaning; a note is
 * already the unit — somebody opened it, wrote it and named it. Splitting one
 * would invent boundaries its author did not.
 */

import { PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'
import type { ResolvedThread } from '@/lib/integrations/gmail-search'
import type { NoteRow } from './read'

export const NOTE_THREAD_PREFIX = 'note:'

/** True for a thread that is a note rather than mail or a text session. */
export function isNoteThread(gmailThreadId: string | null | undefined): boolean {
  return typeof gmailThreadId === 'string' && gmailThreadId.startsWith(NOTE_THREAD_PREFIX)
}

/**
 * Build the thread for one note.
 *
 * ⚠ THE THREAD ID CARRIES THE MODIFICATION TIME, so editing a note produces a
 * NEW row rather than silently leaving the old summary in place. A note is a
 * living document — unlike a text or an email, it is rewritten — and a stale
 * summary of an edited note is worse than two rows, because the record would
 * keep answering with the superseded version and nothing would report it.
 */
export function noteToThread(note: NoteRow, mailbox: string = PRIMARY_MAILBOX): ResolvedThread {
  const stamp = note.modifiedAt.slice(0, 19)
  const threadId = `${NOTE_THREAD_PREFIX}${note.identifier}:${stamp}`

  // Attachments the sweep can SEE but not read are named in the body rather
  // than dropped, so a reader asking "where is the recording" is told it exists
  // and why it is not here. See the note on Media in ./read.ts.
  const unreadable = describeAttachments(note.attachments)
  const body = unreadable ? `${note.body}\n\n---\n${unreadable}` : note.body

  return {
    fingerprint: threadId,
    mailbox,
    threadId,
    subject: note.title || '(untitled note)',
    firstAt: note.createdAt,
    lastAt: note.modifiedAt,
    // A note has no participants. Left as just the owner rather than invented:
    // §12's rule that a thread's recipients are not a deal cast applies doubly
    // when there are none, and a fabricated cast would be matched against
    // `parties` by the enrichment pass.
    participants: [mailbox],
    attachmentCount: note.attachments.length,
    messages: [
      {
        id: threadId,
        threadId,
        // The RFC Message-ID is the real dedupe key for mail; a note has none,
        // so the synthetic thread id stands in. It carries the modification
        // time, which is what makes an edited note a new row.
        messageId: threadId,
        mailbox,
        subject: note.title || '(untitled note)',
        from: { name: 'Note', address: mailbox },
        to: [],
        cc: [],
        receivedAt: note.modifiedAt,
        bodyText: body,
        snippet: body.slice(0, 200),
        attachments: [],
        webLink: '',
      },
    ],
  }
}

/** A sentence naming attachments that exist in Notes but not on this disk. */
function describeAttachments(utis: string[]): string | null {
  if (utis.length === 0) return null
  const audio = utis.filter((u) => /audio|mp3|mpeg-4|coreaudio|quicktime/i.test(u)).length
  const images = utis.filter((u) => /jpeg|heic|png|tiff/i.test(u)).length
  const other = utis.length - audio - images
  const parts: string[] = []
  if (audio) parts.push(`${audio} audio recording${audio === 1 ? '' : 's'}`)
  if (images) parts.push(`${images} image${images === 1 ? '' : 's'}`)
  if (other) parts.push(`${other} other attachment${other === 1 ? '' : 's'}`)
  if (parts.length === 0) return null
  return (
    `[This note carries ${parts.join(', ')} that the platform can see but cannot read: ` +
    `Apple Notes downloads attachment contents only while Notes.app is running, and ` +
    `bw-snapshot copies the database, not the media. To get a recording into the ` +
    `platform, put the audio file in Drive or upload it at /intake?tab=meeting.]`
  )
}
