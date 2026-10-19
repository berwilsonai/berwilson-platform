import { createAdminClient } from '@/lib/supabase/admin'
import UpdatesTab from '@/components/projects/UpdatesTab'
import RecordCorrespondence from '@/components/correspondence/RecordCorrespondence'
import { loadFiledThreads } from '@/lib/email-sweep/filed-threads'

export const metadata = { title: 'Updates — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ new?: string }>
}

export default async function UpdatesPage({ params, searchParams }: PageProps) {
  const { id } = await params
  // `?new=1` — the header's Log menu arriving with the composer already open.
  const { new: startNew } = await searchParams
  const supabase = createAdminClient()

  const [{ data: updates }, filed] = await Promise.all([
    supabase
      .from('updates')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    loadFiledThreads('project', id),
  ])

  return (
    <div className="space-y-4">
      <RecordCorrespondence recordKind="project" recordId={id} initialFiled={filed} />
      <UpdatesTab projectId={id} initialUpdates={updates ?? []} startNew={startNew === '1'} />
    </div>
  )
}
