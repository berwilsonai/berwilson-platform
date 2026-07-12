import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getViewer, canAccessProject, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'
import { runDocumentAiPass } from '@/lib/ai/document-pipeline'

// Re-runs the AI pass (summary + full text + embedding) from the stored file,
// so a doc whose indexing failed or got interrupted never needs a re-upload.
export const maxDuration = 300

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: doc, error: fetchError } = await supabase
    .from('documents')
    .select('id, storage_path, file_name, mime_type, project_id, entity_id, is_company')
    .eq('id', id)
    .single()

  if (fetchError || !doc) {
    return Response.json({ error: 'Document not found' }, { status: 404 })
  }

  // Scoped users may only reindex documents on their granted projects.
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) {
    if (!doc.project_id || !(await canAccessProject(viewer, doc.project_id))) return forbiddenJson()
  }

  const admin = await actorAdminClient()
  const { data: fileBlob, error: downloadError } = await admin.storage
    .from('documents')
    .download(doc.storage_path)

  if (downloadError || !fileBlob) {
    await admin.from('documents').update({ embedding_status: 'error' }).eq('id', id)
    return Response.json(
      { error: `File missing from storage: ${downloadError?.message ?? 'not found'}` },
      { status: 500 }
    )
  }

  // Clear this doc's old chunks so a re-run never double-indexes.
  await admin.from('chunks').delete().eq('document_id', id)

  const result = await runDocumentAiPass({
    supabase: admin,
    documentId: id,
    projectId: doc.project_id,
    entityId: doc.entity_id,
    isCompany: doc.is_company ?? false,
    fileName: doc.file_name,
    mimeType: doc.mime_type,
    buffer: await fileBlob.arrayBuffer(),
  })

  return Response.json({
    status: result.status,
    ai_summary: result.aiSummary,
  })
}
