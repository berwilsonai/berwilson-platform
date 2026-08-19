import type { Metadata } from 'next'
import { Gavel } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import CompanySectionTabs from '@/components/company/CompanySectionTabs'
import MeetingsView from '@/components/meetings/MeetingsView'
import { fetchMeetingPickerData } from '@/lib/meetings/picker-data'

export const metadata: Metadata = {
  title: 'Board & Governance — Ber Wilson Intelligence',
}

export default async function BoardMeetingsPage() {
  const supabase = createAdminClient()
  const viewer = await getViewer()
  const isAdmin = viewer?.isAdmin ?? false

  const { data: meetings } = await supabase
    .from('meetings')
    .select('*')
    .eq('scope', 'company')
    .order('meeting_date', { ascending: false })

  const ids = (meetings ?? []).map((m) => m.id)
  const { data: files } = ids.length
    ? await supabase.from('documents').select('*').in('meeting_id', ids).order('uploaded_at', { ascending: false })
    : { data: [] }

  const { teamMembers, contacts } = await fetchMeetingPickerData(supabase)

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-900/40 flex items-center justify-center shrink-0">
          <Gavel size={20} className="text-slate-500 dark:text-slate-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Board & Governance</h1>
          <p className="text-sm text-muted-foreground">Meeting minutes, resolutions, and recordings — the corporate record.</p>
        </div>
      </div>

      <CompanySectionTabs active="board" showProfile />

      <MeetingsView
        scope="company"
        initialMeetings={meetings ?? []}
        initialFiles={files ?? []}
        teamMembers={teamMembers}
        contacts={contacts}
        canEdit={isAdmin}
        canDelete={isAdmin}
      />
    </div>
  )
}
