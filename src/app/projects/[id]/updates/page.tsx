import { createAdminClient } from '@/lib/supabase/admin'
import UpdatesTab from '@/components/projects/UpdatesTab'
import RecordCorrespondence from '@/components/correspondence/RecordCorrespondence'
import { loadFiledThreads } from '@/lib/email-sweep/filed-threads'

export const metadata = { title: 'Updates — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function UpdatesPage({ params }: PageProps) {
  const { id } = await params
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
      <UpdatesTab projectId={id} initialUpdates={updates ?? []} />
    </div>
  )
}
