import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import DocumentsTab from '@/components/projects/DocumentsTab'
import ComposeDocument from '@/components/documents/ComposeDocument'

export const metadata = { title: 'Documents — Ber Wilson Intelligence' }

/** Rows the tab renders. One under PostgREST's own silent cap, deliberately. */
const DOCUMENT_LIMIT = 999

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function DocumentsPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  // The project row is fetched only for its Drive folder link, so the tab can
  // show "open the folder" without a round trip to Google on every render.
  const [{ data: documents }, { data: project }, viewer] = await Promise.all([
    // ⚠ EXPLICIT, because PostgREST truncates at 1000 rows SILENTLY (§12) and a
    // flat `select('*')` would simply stop listing a bigger data room with
    // nothing anywhere saying so. Asking for 1001 is how the page can tell a
    // record that happens to hold exactly the cap from one that has more: if
    // the extra row comes back, the list is incomplete and says so.
    //
    // The biggest record today is 187 documents (Weirton, whose rail diligence
    // shelf alone is 105), so this is a guard and not a live limit.
    supabase
      .from('documents')
      .select('*')
      .eq('project_id', id)
      .order('uploaded_at', { ascending: false })
      .limit(DOCUMENT_LIMIT + 1),
    supabase
      .from('projects')
      .select('drive_folder_url, deal_folder_id, drive_source_folder_id, drive_source_folder_url, confidential')
      .eq('id', id)
      .maybeSingle(),
    getViewer(),
  ])

  const rows = documents ?? []
  const truncated = rows.length > DOCUMENT_LIMIT

  return (
    <div className="space-y-4">
      {/* Ber AI writes one from this deal's records; the tab below lists what
          the deal already holds. Deliberately NOT count-gated — a record with
          no documents is exactly where a one-pager is wanted (§12). */}
      <ComposeDocument
        kind="project"
        recordId={id}
        confidential={project?.confidential ?? false}
      />
      <DocumentsTab
        projectId={id}
        initialDocuments={truncated ? rows.slice(0, DOCUMENT_LIMIT) : rows}
        truncated={truncated}
        driveFolderUrl={project?.drive_folder_url ?? null}
        hasDealFolder={!!project?.deal_folder_id}
        sourceFolderId={project?.drive_source_folder_id ?? null}
        sourceFolderUrl={project?.drive_source_folder_url ?? null}
        // Publishing copies documents out of the tailnet, so it is a sharing
        // decision — admin-only, matching the API's own guard.
        canPublish={viewer?.isAdmin ?? false}
      />
    </div>
  )
}
