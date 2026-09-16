/**
 * In-app activity notifications — the bell in the header.
 *
 * The problem this solves: two executives work the same portfolio from
 * different places, and neither could see what the other had just done. A
 * document Eric filed in Drive reached the project silently — the sync posted a
 * line to that project's feed, which you only see if you are already on that
 * project. This turns "something arrived" into something that finds you.
 *
 * Recipients are team members who can ACTUALLY SEE a bell: active, and linked to
 * an auth account. Writing rows for someone with no login would fill a table
 * nobody will ever read, and would make the unread counts meaningless the day
 * somebody does get a login.
 *
 * The actor is excluded by email. Matching is case-insensitive against
 * `team_members.email`, which is exactly what Drive returns in
 * `lastModifyingUser.emailAddress` for a Workspace user. An actor who matches
 * NOBODY — info@, an outside collaborator on a shared folder — means everyone is
 * notified, which is correct: an upload by someone outside the team is the
 * activity most worth knowing about, not the least.
 *
 * Nothing here ever throws. A missing notification must never fail the import,
 * the upload, or the sync that produced it.
 */

import { createAdminClient } from '@/lib/supabase/admin'

export type NotificationKind =
  | 'document_added'
  | 'document_revised'
  | 'documents_batch'
  // A rep generated a quote priced below the $30/SF floor. It cannot be issued
  // until an admin or executive approves it, so somebody has to be told.
  | 'quote_below_floor'

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

interface Recipient {
  id: string
  email: string | null
}

/**
 * Everyone who can see a notification.
 *
 * Exported so a caller can decide there is no audience before doing work to
 * describe an event nobody will read.
 */
export async function notificationRecipients(): Promise<Recipient[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('team_members')
    .select('id, email')
    .eq('active', true)
    .not('auth_user_id', 'is', null)

  if (error) {
    console.error('[notifications] could not load recipients:', error.message)
    return []
  }
  return (data ?? []) as Recipient[]
}

/**
 * Fan a batch of events out to every eligible recipient except each event's own
 * actor, in one insert.
 *
 * Batched deliberately: a Drive sync produces a run's worth of arrivals at once,
 * and one insert per document per person would be dozens of round trips for a
 * single folder link.
 *
 * @returns how many notification rows were written.
 */
export async function notifyTeam(
  events: NotificationEvent[],
  opts: { recipients?: Recipient[] } = {}
): Promise<number> {
  if (events.length === 0) return 0

  try {
    const recipients = opts.recipients ?? (await notificationRecipients())
    if (recipients.length === 0) return 0

    const rows = []
    for (const event of events) {
      const actor = event.actorEmail?.trim().toLowerCase() || null
      for (const person of recipients) {
        if (actor && person.email?.trim().toLowerCase() === actor) continue
        rows.push({
          team_member_id: person.id,
          kind: event.kind,
          title: event.title,
          body: event.body ?? null,
          href: event.href ?? null,
          external_url: event.externalUrl ?? null,
          actor_name: event.actorName ?? null,
          document_id: event.documentId ?? null,
          project_id: event.projectId ?? null,
        })
      }
    }
    if (rows.length === 0) return 0

    const { error } = await createAdminClient().from('notifications').insert(rows)
    if (error) {
      // 42P01 = the table does not exist yet. The code ships before the
      // migration is applied, and a missing bell must not break a Drive sync.
      if (error.code !== '42P01') {
        console.error('[notifications] insert failed:', error.message)
      }
      return 0
    }
    return rows.length
  } catch (err) {
    console.error('[notifications] failed:', err instanceof Error ? err.message : String(err))
    return 0
  }
}
