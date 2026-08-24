import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import MeetingsView from '@/components/meetings/MeetingsView'
import { fetchMeetingPickerData } from '@/lib/meetings/picker-data'

export const metadata = { title: 'Meetings — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ProjectMeetingsPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()
  const viewer = await getViewer()
  // v1 is admin-driven: non-admins with project access read the log (and can
  // play/download recordings), but creating/editing records stays admin-only.
  const isAdmin = viewer?.isAdmin ?? false

  const { data: meetings } = await supabase
    .from('meetings')
    .select('*')
    .eq('project_id', id)
    .order('meeting_date', { ascending: false })

  const ids = (meetings ?? []).map((m) => m.id)
  const { data: files } = ids.length
    ? await supabase.from('documents').select('*').in('meeting_id', ids).order('uploaded_at', { ascending: false })
    : { data: [] }

  const { teamMembers, contacts } = await fetchMeetingPickerData(supabase)

  return (
    <MeetingsView
      scope="project"
      projectId={id}
      initialMeetings={meetings ?? []}
      initialFiles={files ?? []}
      teamMembers={teamMembers}
      contacts={contacts}
      canEdit={isAdmin}
      canDelete={isAdmin}
    />
  )
}
