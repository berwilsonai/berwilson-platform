import { createAdminClient } from '@/lib/supabase/admin'
import DocumentsTab from '@/components/projects/DocumentsTab'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function DocumentsPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: documents } = await supabase
    .from('documents')
    .select('*')
    .eq('project_id', id)
    .order('uploaded_at', { ascending: false })

  return <DocumentsTab projectId={id} initialDocuments={documents ?? []} />
}
