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
import type { Json } from '@/types/database'
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
      .select('id, record_id')
      .eq('table_name', 'parties')
      .eq('action', MEETING_ATTENDED_ACTION)
      .filter('metadata->>meeting_id', 'eq', meeting.id)
    const existingByParty = new Map<string, string>()
    for (const row of existing ?? []) {
      if (row.record_id) existingByParty.set(row.record_id, row.id)
    }

    const metadata = {
      meeting_id: meeting.id,
      title: meeting.title,
      meeting_date: meeting.meeting_date,
      scope: meeting.scope,
      project_id: meeting.project_id,
      opportunity_id: meeting.opportunity_id,
    } as unknown as Json

    // Insert entries for newly-linked parties.
    const toInsert = [...desired]
      .filter((pid) => !existingByParty.has(pid))
      .map((pid) => ({
        table_name: 'parties',
        record_id: pid,
        action: MEETING_ATTENDED_ACTION,
        metadata,
      }))
    if (toInsert.length) await supabase.from('activity_log').insert(toInsert)

    // Remove entries for parties no longer on the meeting.
    const toDelete = [...existingByParty.entries()]
      .filter(([pid]) => !desired.has(pid))
      .map(([, rowId]) => rowId)
    if (toDelete.length) await supabase.from('activity_log').delete().in('id', toDelete)
  } catch (err) {
    console.error('[meetings] syncAttendeeActivity failed:', err)
  }
}
