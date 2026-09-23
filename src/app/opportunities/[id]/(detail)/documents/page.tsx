import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import OpportunityDocuments from '@/components/opportunities/OpportunityDocuments'

export const metadata = { title: 'Documents — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function OpportunityDocumentsPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const [{ data: opportunity }, { data: documents }, viewer] = await Promise.all([
    supabase.from('opportunities').select('drive_folder_url').eq('id', id).single(),
    supabase
      .from('opportunity_documents')
      .select('*')
      .eq('opportunity_id', id)
      .order('uploaded_at', { ascending: false }),
    getViewer(),
  ])

  return (
    <OpportunityDocuments
      opportunityId={id}
      documents={documents ?? []}
      driveFolderUrl={opportunity?.drive_folder_url ?? null}
      canPublish={viewer?.isAdmin ?? false}
    />
  )
}
