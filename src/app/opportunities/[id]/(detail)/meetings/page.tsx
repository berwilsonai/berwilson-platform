import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import MeetingsView from '@/components/meetings/MeetingsView'
import { fetchMeetingPickerData } from '@/lib/meetings/picker-data'
import type { Meeting, Document as DocumentRow } from '@/lib/supabase/types'

export const metadata = { title: 'Meetings — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function OpportunityMeetingsPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const [{ data: meetings }, viewer] = await Promise.all([
    supabase
      .from('meetings')
      .select('*')
      .eq('opportunity_id', id)
      .order('meeting_date', { ascending: false }),
    getViewer(),
  ])

  const meetingIds = (meetings ?? []).map((m) => m.id)
  const { data: meetingFiles } = meetingIds.length
    ? await supabase.from('documents').select('*').in('meeting_id', meetingIds).order('uploaded_at', { ascending: false })
    : { data: [] }
  const { teamMembers, contacts } = await fetchMeetingPickerData(supabase)

  return (
    <MeetingsView
      scope="opportunity"
      opportunityId={id}
      initialMeetings={(meetings ?? []) as Meeting[]}
      initialFiles={(meetingFiles ?? []) as DocumentRow[]}
      teamMembers={teamMembers}
      contacts={contacts}
      canEdit={viewer?.isAdmin ?? false}
      canDelete={viewer?.isAdmin ?? false}
    />
  )
}
