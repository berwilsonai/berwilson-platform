import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import OpportunityDocuments from '@/components/opportunities/OpportunityDocuments'
import ComposeDocument from '@/components/documents/ComposeDocument'

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
    <div className="space-y-4">
      {/* Ber AI writes one from this deal's records; the tab below lists what
          the deal already holds. Deliberately NOT count-gated — a record with
          no documents is exactly where a one-pager is wanted (§12). */}
      <ComposeDocument kind="opportunity" recordId={id} />
      <OpportunityDocuments
        opportunityId={id}
        documents={documents ?? []}
        driveFolderUrl={opportunity?.drive_folder_url ?? null}
        canPublish={viewer?.isAdmin ?? false}
      />
    </div>
  )
}
