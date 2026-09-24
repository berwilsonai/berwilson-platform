/**
 * Activity announcements — "something arrived, and you were not looking at it".
 *
 * The problem this solves: two executives work the same portfolio from
 * different places, and neither could see what the other had just done. A
 * document Eric filed in Drive reached the project silently — the sync posted a
 * line to that project's feed, which you only see if you are already on that
 * project.
 *
 * ⚠ GOOGLE CHAT IS THE CHANNEL. THE IN-APP BELL WAS REMOVED 2026-09-24, and the
 * reason is measured rather than assumed: across the 8 days it ran it wrote 52
 * rows and **0 were ever read or dismissed**. It could not have been otherwise —
 * the bell lives inside a tailnet-only platform that most of the company cannot
 * reach, so it was a channel with no audience, while the same events had been
 * mirrored to Chat since 2026-09-22 and Chat is where they actually get read.
 *
 * ⚠ AND MIRRORING WAS OPT-IN PER CALL SITE, WHICH IS WHY THIS IS ONE FUNCTION
 * NOW. Only 2 of the 4 callers paired their bell write with `broadcastEvents`,
 * so a dev-note report and a below-floor quote needing approval reached NOBODY
 * AT ALL — bell unread, no post. A second channel a caller can forget is a
 * channel that will be forgotten, so the fan-out lives here and callers get no
 * say in it.
 *
 * Nothing here ever throws. A missing announcement must never fail the import,
 * the upload, or the sync that produced it.
 */

import { broadcastEvents } from './broadcast'

export type NotificationKind =
  | 'document_added'
  | 'document_revised'
  | 'documents_batch'
  // A rep generated a quote priced below the $30/SF floor. It cannot be issued
  // until an admin or executive approves it, so somebody has to be told.
  | 'quote_below_floor'
  // Mail the sweep filed onto a record with certainty. Deliberately NOT raised
  // for an inferred match: that is a proposal, and it already has a destination
  // in the review queue. Announcing a guess to everyone would make the bell the
  // thing you check to find out what the platform got wrong.
  | 'correspondence'
  // A teammate filed a bug report or feature request from inside the app.
  // Raised to ADMINS ONLY (devNoteRecipients) — it is addressed to whoever
  // fixes the platform, and fanning it to everyone would put one person's UI
  // complaint in front of people who can do nothing with it.
  | 'dev_note'

/** One event, before it is fanned out to recipients. */
export interface NotificationEvent {
  kind: NotificationKind
  title: string
  body?: string | null
  /** In-app destination, e.g. `/projects/<id>/documents`. */
  href?: string | null
  /** The original in Drive, when there is one. */
  externalUrl?: string | null
  actorName?: string | null
  /** Used only to exclude the person who did it. Never stored. */
  actorEmail?: string | null
  documentId?: string | null
  projectId?: string | null
}

/**
 * Announce a batch of events.
 *
 * Batched deliberately: a Drive sync produces a run's worth of arrivals at once,
 * and one post per document would turn a single folder link into a wall of
 * messages — which is how a channel teaches people to mute it. Grouping above a
 * threshold is the caller's job (see `composeArrivalNotifications`).
 *
 * `actorEmail` is still carried on the event because callers use it to decide
 * whether an event is worth describing at all; a Chat space has one audience, so
 * there is no per-person actor exclusion to apply here.
 *
 * @returns how many events were announced — 0 when Chat is not configured.
 */
export async function notifyTeam(events: NotificationEvent[]): Promise<number> {
  if (events.length === 0) return 0
  try {
    const posted = await broadcastEvents(events)
    return posted ? events.length : 0
  } catch (err) {
    console.error('[notifications] failed:', err instanceof Error ? err.message : String(err))
    return 0
  }
}
