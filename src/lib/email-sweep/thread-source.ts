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
 *   now    a voice memo of an in-person meeting arrives the same way again.
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
  if (gmailThreadId.startsWith(NOTE_THREAD_PREFIX)) {
    return noteThreadKind(gmailThreadId, subject) === 'call' ? 'call' : 'note'
  }
  return 'email'
}

/**
 * Every thread-id prefix that means "this exists only on this box".
 *
 * Exported as the registry it is, so a reader filtering by prefix in SQL does
 * not have to assemble the list itself.
 */
export const LOCAL_THREAD_PREFIXES = [
  IMESSAGE_THREAD_PREFIX,
  NOTE_THREAD_PREFIX,
  VOICEMEMO_THREAD_PREFIX,
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
