import { createAdminClient } from '@/lib/supabase/admin'
import UpdatesTab from '@/components/projects/UpdatesTab'

export const metadata = { title: 'Updates — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function UpdatesPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: updates } = await supabase
    .from('updates')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: false })

  return <UpdatesTab projectId={id} initialUpdates={updates ?? []} />
}
