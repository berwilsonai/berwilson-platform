/**
 * WHERE A THREAD CAME FROM — asked once, answered in one place.
 *
 * ⚠ THIS FILE EXISTS BECAUSE THE SAME BUG HAS NOW COST HOURS THREE TIMES, AND
 * EACH FIX COVERED ONLY THE SOURCE BEING ADDED THAT DAY.
 *
 *   10-11  texts arrive as `email_threads` rows and `apply-phase.ts` stamped
 *          `source: 'email'` on them. Fixed for texts (migration …011000003).
 *   10-14  a recorded phone call and a filed note arrive the same way and fell
 *          into the same `else`. The Helper project's feed read, on the live
 *          row: `source=email`, "Email — Call with Eric Tuaone" — false in both
 *          arms. Fixed for notes (migration …014000001).
 *   10-15  a voice memo of an in-person meeting arrives the same way again.
 *   now    audio dropped in a Drive folder (a hardware recorder) arrives the
 *          same way a FOURTH time — and this is the first one the closed union
 *          below actually caught, because it maps onto the existing `recording`
 *          member rather than needing a new one. The prefix still has to be
 *          named in both places here: `threadSource` would otherwise call it
 *          `email` and stamp a project's feed "Email — Steelton — 2026-10-18",
 *          and `isLocalThread` would send a synthetic id to a live Gmail fetch.
 *
 * Four readers were each branching on this question with their own predicate,
 * which is what let the second and third fixes miss the others:
 * `apply-phase.ts` (provenance AND the Gmail attachment fetch),
 * `summarize-phase.ts` (discard a private transcript), `curator/evidence.ts`
 * (what KIND of evidence to show the model) and `commitments/chase.ts` (whether
 * a Gmail draft is even possible). §12 — when a function branches on where
 * something came from, every source that can reach it needs an arm, not just
 * the one being added today.
 *
 * So the branch is written ONCE, over an exhaustive switch, and
 * {@link ThreadSource} is a closed union: adding a member makes every switch in
 * this file fail to compile until it has an arm. That is the whole point — the
 * build now names the drifted arm instead of a project's feed naming it months
 * later.
 *
 * ⚠ KEYED ON `gmail_thread_id`, WHICH IS STRUCTURAL. It is the one column that
 * can never hold a Gmail id for a local source, where `mailbox` is deliberately
 * set to the owner's real address on every one of these (attribution, the
 * commitment filter and the chase pass all need it to find a real team member).
 * §12: key a guard on the structural thing, not on a display string.
 */

import { IMESSAGE_THREAD_PREFIX } from '@/lib/imessage/to-thread'
import { NOTE_THREAD_PREFIX, noteThreadKind } from '@/lib/notes/to-thread'
import { VOICEMEMO_THREAD_PREFIX } from '@/lib/voicememos/to-thread'
import { DRIVE_AUDIO_THREAD_PREFIX } from '@/lib/driveaudio/to-thread'
import { UPLOAD_THREAD_ID_PREFIX } from '@/lib/audio/upload-ref'
import type { Database } from '@/types/database'

/**
 * Every kind of thing that can become an `email_threads` row.
 *
 * ⚠ THESE ARE THE `update_source` ENUM'S OWN MEMBERS, and the assertion below
 * holds them to it. A value outside an enum fails the whole UPDATE rather than
 * the row (§12), so a source named here but never added to the type in Postgres
 * would discard every other field in the same write.
 */
export type ThreadSource = 'email' | 'imessage' | 'note' | 'call' | 'recording'

/** Compile-time proof that every ThreadSource is a real `update_source` value. */
type UpdateSource = Database['public']['Enums']['update_source']
const _sourcesExistInPostgres: readonly UpdateSource[] = [
  'email',
  'imessage',
  'note',
  'call',
  'recording',
] satisfies readonly ThreadSource[]
void _sourcesExistInPostgres

/**
 * What produced this thread.
 *
 * `subject` is needed for one distinction only: a recorded phone call and a
 * typed note are both `note:` rows, and iOS's own `Call with <name>` title is
 * what tells them apart (see `noteThreadKind`). Pass it when the row has one;
 * a missing subject degrades a call to `note`, never to `email`.
 */
export function threadSource(
  gmailThreadId: string | null | undefined,
  subject?: string | null
): ThreadSource {
  if (typeof gmailThreadId !== 'string') return 'email'
  if (gmailThreadId.startsWith(IMESSAGE_THREAD_PREFIX)) return 'imessage'
  if (gmailThreadId.startsWith(VOICEMEMO_THREAD_PREFIX)) return 'recording'
  // Audio filed in the Drive intake folder. The same member as a voice memo on
  // purpose: to every reader downstream these are one kind of thing — a
  // conversation somebody recorded, transcribed on this box — and they differ
  // only in how the bytes arrived. A new member would mean an `update_source`
  // enum migration and a new arm in every switch that already handles this one.
  if (gmailThreadId.startsWith(DRIVE_AUDIO_THREAD_PREFIX)) return 'recording'
  // An mp3 a person uploaded onto a record (10-19). The same `recording` member
  // again, for the reason written just above — and the omission of this ONE LINE
  // is what left an upload's meeting `unfiled` under a correctly `linked`
  // thread: `fileMeetingFromThreadLinks` opens with `source !== 'call' &&
  // source !== 'recording'`, so an unrecognised prefix is classified `email`
  // and the whole filing step is skipped silently. Three separate prefix
  // switches had to learn this door — here, `meetingRefFromThreadId`, and
  // LOCAL_THREAD_PREFIXES below — and only the middle one was obvious.
  if (gmailThreadId.startsWith(UPLOAD_THREAD_ID_PREFIX)) return 'recording'
  if (gmailThreadId.startsWith(NOTE_THREAD_PREFIX)) {
    return noteThreadKind(gmailThreadId, subject) === 'call' ? 'call' : 'note'
  }
  return 'email'
}

/**
 * Every thread-id prefix that means "there is no Gmail thread behind this row".
 *
 * Exported as the registry it is, so a reader filtering by prefix in SQL does
 * not have to assemble the list itself.
 *
 * ⚠ IT ANSWERS TWO QUESTIONS AND THE SECOND ONE IS A DISCARD. Besides keeping a
 * synthetic id out of a live Gmail fetch, this list is what `redact.ts` filters
 * on — so a prefix named here means a `noise` verdict DISCARDS the text. That
 * is wanted for every member: a text conversation, a note, a memo and a
 * recording all carry someone's private life in a way `moose@`'s inbox does
 * not. `driveaudio:` keeps it even though a human filed that file deliberately,
 * because the cost of being wrong is asymmetric and recoverable — the mp3 is
 * untouched in Drive (audio deletion is gated on `isVoiceMemoThread`), so a
 * misjudged recording is re-read by uploading a copy.
 */
export const LOCAL_THREAD_PREFIXES = [
  IMESSAGE_THREAD_PREFIX,
  NOTE_THREAD_PREFIX,
  VOICEMEMO_THREAD_PREFIX,
  DRIVE_AUDIO_THREAD_PREFIX,
  // `upload:` is here for the FIRST of the two questions only — keeping a
  // synthetic id out of a live Gmail fetch. The discard half cannot fire on it:
  // the upload path skips the work/noise gate entirely (a human who attached a
  // file to a named deal has already judged it), so no `noise` verdict exists
  // to redact. It is listed anyway rather than special-cased, because the day
  // somebody does run a verdict over these rows, discarding is the safe answer.
  UPLOAD_THREAD_ID_PREFIX,
] as const

/**
 * Is there a real Gmail thread behind this row?
 *
 * ⚠ THE QUESTION `importThreadAttachments` SHOULD HAVE BEEN ASKING. It bailed
 * on `isIMessageThread` alone, so a note or a call thread reached a live Gmail
 * `fetchThread` call with a synthetic id — a 404 against a real mailbox, inside
 * a try/catch, costing a round trip and reporting nothing.
 */
export function isLocalThread(gmailThreadId: string | null | undefined): boolean {
  return (
    typeof gmailThreadId === 'string' &&
    LOCAL_THREAD_PREFIXES.some((p) => gmailThreadId.startsWith(p))
  )
}

/**
 * What to call a thread whose own subject is empty.
 *
 * A local source nearly always has a subject the ingestion wrote ("Texts with
 * X — date", "Call with X", the memo's title), so this is the fallback and not
 * the normal path.
 */
export function threadSourceLabel(source: ThreadSource): string {
  switch (source) {
    case 'imessage':
      return 'Text conversation'
    case 'call':
      return 'Recorded call'
    case 'note':
      return 'Note'
    case 'recording':
      return 'Recorded meeting'
    case 'email':
      return 'Email thread'
  }
}

/**
 * The heading an `updates` row carries on a record's feed.
 *
 * ⚠ ONLY MAIL GETS A PREFIX, and that is measured rather than stylistic: a
 * local source's subject is already self-describing, so prefixing all of them
 * produced "Texts — Texts with …" and "Email — Call with Eric Tuaone". A mail
 * subject is not self-describing, so it keeps its "Email — ".
 */
export function threadUpdateHeading(
  source: ThreadSource,
  subject: string | null | undefined
): string {
  const label = subject?.trim() || threadSourceLabel(source)
  return source === 'email' ? `Email — ${label}` : label
}
