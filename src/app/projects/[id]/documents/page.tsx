import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import DocumentsTab from '@/components/projects/DocumentsTab'

export const metadata = { title: 'Documents — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function DocumentsPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  // The project row is fetched only for its Drive folder link, so the tab can
  // show "open the folder" without a round trip to Google on every render.
  const [{ data: documents }, { data: project }, viewer] = await Promise.all([
    supabase
      .from('documents')
      .select('*')
      .eq('project_id', id)
      .order('uploaded_at', { ascending: false }),
    supabase.from('projects').select('drive_folder_url').eq('id', id).maybeSingle(),
    getViewer(),
  ])

  return (
    <DocumentsTab
      projectId={id}
      initialDocuments={documents ?? []}
      driveFolderUrl={project?.drive_folder_url ?? null}
      // Publishing copies documents out of the tailnet, so it is a sharing
      // decision — admin-only, matching the API's own guard.
      canPublish={viewer?.isAdmin ?? false}
    />
  )
}
