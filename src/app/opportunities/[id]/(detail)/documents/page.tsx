import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import OpportunityDocuments from '@/components/opportunities/OpportunityDocuments'
import ComposeDocument from '@/components/documents/ComposeDocument'
import OutlierPanel from '@/components/dataroom/OutlierPanel'
import { readMirror } from '@/lib/dataroom/mirror'

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

  /**
   * Outliers — what this record holds that Drive does not currently back.
   *
   * Read here rather than inside `DocumentsTab` because that tab is a
   * thousand-line client component and this is a server read; threading it
   * through would mean passing the whole mirror as a prop and re-rendering the
   * list for it. ⚠ Caught rather than thrown: a Drive or database hiccup must
   * cost the panel, never the documents list underneath it.
   */
  const mirror = await readMirror('opportunity', id).catch(() => null)

  return (
    <div className="space-y-4">
      {/* Ber AI writes one from this deal's records; the tab below lists what
          the deal already holds. Deliberately NOT count-gated — a record with
          no documents is exactly where a one-pager is wanted (§12). */}
      <ComposeDocument kind="opportunity" recordId={id} />
      {mirror ? <OutlierPanel mirror={mirror} /> : null}
      <OpportunityDocuments
        opportunityId={id}
        documents={documents ?? []}
        driveFolderUrl={opportunity?.drive_folder_url ?? null}
        canPublish={viewer?.isAdmin ?? false}
      />
    </div>
  )
}
