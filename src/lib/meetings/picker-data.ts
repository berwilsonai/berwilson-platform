// Server-side fetch of the data the meeting attendee picker needs: the active
// Ber Wilson team roster and the full contacts directory. Mirrors the fetch the
// meeting-intake review page already does. Kept tiny so every meeting surface
// (board / project / opportunity) loads the pickers identically.

import type { createAdminClient } from '@/lib/supabase/admin'
import type { TeamMemberOption, ContactOption } from '@/components/meetings/MeetingAttendees'

type AdminClient = ReturnType<typeof createAdminClient>

export async function fetchMeetingPickerData(
  supabase: AdminClient,
): Promise<{ teamMembers: TeamMemberOption[]; contacts: ContactOption[] }> {
  const [{ data: teamMembers }, { data: contacts }] = await Promise.all([
    supabase.from('team_members').select('id, name, party_id').eq('active', true).order('name'),
    supabase.from('parties').select('id, full_name, company, email, is_organization').order('full_name'),
  ])
  return { teamMembers: teamMembers ?? [], contacts: contacts ?? [] }
}
