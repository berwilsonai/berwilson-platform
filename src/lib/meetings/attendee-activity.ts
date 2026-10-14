// When a meeting names attendees who are linked to directory contacts
// (attendee.party_id), log the meeting on each of those contacts' profiles via
// an activity_log row. Idempotent per meeting: reconciles the set of logged
// parties against the current attendee links, so editing a meeting (adding or
// removing attendees) never duplicates or strands entries.
//
// The write is an app-level insert (not the DB trigger) into activity_log with
// table_name='parties' + record_id=<party_id>, matching how the contact page
// reads activity for a party. Non-fatal — a save still succeeds if this fails.

import type { createAdminClient } from '@/lib/supabase/admin'
import type { JsonIn } from '@/lib/supabase/types'
import { parseAttendees } from '@/lib/utils/meetings'

type AdminClient = ReturnType<typeof createAdminClient>

export const MEETING_ATTENDED_ACTION = 'meeting_attended'

interface MeetingForActivity {
  id: string
  title: string
  meeting_date: string
  scope: string
  project_id: string | null
  opportunity_id: string | null
  /**
   * 'call' | 'client' | 'board' | … — what sort of meeting this was.
   *
   * Carried so the contact's profile can say "Call" rather than guessing. The
   * reader used to print "Project meeting" for every row, including a scope of
   * 'unfiled', which is neither a project nor a claim anyone made (§12: never
   * print a stored enum at a reader, and never invent one).
   */
  kind?: string | null
}

/**
 * Reconcile the contact-profile activity entries for a meeting's linked
 * attendees. `attendees` is the raw jsonb value from the meeting row.
 */
export async function syncAttendeeActivity(
  supabase: AdminClient,
  meeting: MeetingForActivity,
  attendees: unknown,
): Promise<void> {
  try {
    const linked = parseAttendees(attendees)
      .map((a) => a.party_id)
      .filter((id): id is string => !!id)
    const desired = new Set(linked)

    // Existing entries for THIS meeting (via metadata->>meeting_id).
    const { data: existing } = await supabase
      .from('activity_log')
      .select('id, record_id, metadata')
      .eq('table_name', 'parties')
      .eq('action', MEETING_ATTENDED_ACTION)
      .filter('metadata->>meeting_id', 'eq', meeting.id)
    const existingByParty = new Map<string, { id: string; metadata: unknown }>()
    for (const row of existing ?? []) {
      if (row.record_id) existingByParty.set(row.record_id, { id: row.id, metadata: row.metadata })
    }

    const fields = {
      meeting_id: meeting.id,
      title: meeting.title,
      meeting_date: meeting.meeting_date,
      scope: meeting.scope,
      kind: meeting.kind ?? null,
      project_id: meeting.project_id,
      opportunity_id: meeting.opportunity_id,
    }
    const metadata = fields as unknown as JsonIn

    // ⚠ A ROW THAT ALREADY EXISTS IS REWRITTEN WHEN THE MEETING HAS MOVED ON.
    // §12: an orphaned projection looks perfectly live. This copy carries the
    // title, the date and the SCOPE, and all three change under it — a recorded
    // call is written `unfiled` and filed onto a deal minutes later, and a
    // reviewer can retitle a meeting at any time. Reconciling only the party
    // SET left the contact's profile saying "not filed on a deal yet", linking
    // to the review queue, about a call that was by then on a project.
    //
    // Rewritten by delete-then-insert, which is the pair of operations this
    // function already performs on this table — `activity_log` takes no UPDATE,
    // and these rows are a projection of the meeting rather than an audit entry
    // (the audit of the meeting itself is the trigger's own row on `meetings`).
    const stale = [...existingByParty.entries()]
      .filter(([pid, row]) => desired.has(pid) && !sameMetadata(row.metadata, fields))
      .map(([pid, row]) => ({ pid, id: row.id }))

    // Insert entries for newly-linked parties, and for the ones being refreshed.
    const toInsert = [...desired]
      .filter((pid) => !existingByParty.has(pid) || stale.some((s) => s.pid === pid))
      .map((pid) => ({
        table_name: 'parties',
        record_id: pid,
        action: MEETING_ATTENDED_ACTION,
        metadata,
      }))

    // Remove entries for parties no longer on the meeting, plus the stale ones
    // being replaced. Deleted FIRST, so a failure on the insert leaves nothing
    // duplicated — the next sync re-adds what is missing.
    const toDelete = [
      ...[...existingByParty.entries()].filter(([pid]) => !desired.has(pid)).map(([, row]) => row.id),
      ...stale.map((s) => s.id),
    ]
    if (toDelete.length) await supabase.from('activity_log').delete().in('id', toDelete)
    if (toInsert.length) await supabase.from('activity_log').insert(toInsert)
  } catch (err) {
    console.error('[meetings] syncAttendeeActivity failed:', err)
  }
}

/**
 * Does the stored copy still say what the meeting says?
 *
 * Compared field by field over the keys we write, not by stringifying: jsonb
 * does not preserve key order, so two equal objects serialize differently and
 * every sync would rewrite every row.
 */
function sameMetadata(stored: unknown, fields: Record<string, unknown>): boolean {
  if (!stored || typeof stored !== 'object') return false
  const s = stored as Record<string, unknown>
  return Object.keys(fields).every((k) => (s[k] ?? null) === (fields[k] ?? null))
}
