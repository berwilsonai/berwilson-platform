import { NextRequest } from 'next/server'
import { runDocumentAiPass } from '@/lib/ai/document-pipeline'
import { getViewer, canAccessProject, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'

// Summary + full-text transcription + embedding can take a few minutes on big PDFs
export const maxDuration = 300

interface InsertBody {
  project_id: string
  storage_path: string
  file_name: string
  file_size_bytes: number
  mime_type: string
  doc_type: string
  extract_ai: boolean
}

export async function POST(request: NextRequest) {
  const supabase = await actorAdminClient()

  let body: InsertBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { project_id, storage_path, file_name, file_size_bytes, mime_type, doc_type, extract_ai } = body

  if (!project_id || !storage_path || !file_name) {
    return Response.json({ error: 'project_id, storage_path, and file_name are required' }, { status: 400 })
  }

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin && !(await canAccessProject(viewer, project_id))) return forbiddenJson()

  // Insert document record
  const { data: doc, error: insertError } = await supabase
    .from('documents')
    .insert({
      project_id,
      storage_path,
      file_name,
      file_size_bytes: file_size_bytes ?? null,
      mime_type: mime_type ?? null,
      doc_type: doc_type ?? 'other',
      source: 'document',
    })
    .select()
    .single()

  if (insertError || !doc) {
    return Response.json({ error: insertError?.message ?? 'Insert failed' }, { status: 500 })
  }

  if (extract_ai) {
    // File was uploaded to storage by the client — pull it back for the AI pass.
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('documents')
      .download(storage_path)

    if (downloadError || !fileBlob) {
      await supabase.from('documents').update({ embedding_status: 'error' }).eq('id', doc.id)
      doc.embedding_status = 'error'
    } else {
      // Never throws — settles embedding_status to complete/error/skipped.
      const result = await runDocumentAiPass({
        supabase,
        documentId: doc.id,
        projectId: project_id,
        fileName: file_name,
        mimeType: mime_type ?? null,
        buffer: await fileBlob.arrayBuffer(),
      })
      doc.ai_summary = result.aiSummary ?? doc.ai_summary
      doc.confidence = result.confidence ?? doc.confidence
      doc.embedding_status = result.status
    }
  } else {
    // No AI requested — don't leave the doc looking like it's indexing.
    await supabase.from('documents').update({ embedding_status: 'skipped' }).eq('id', doc.id)
    doc.embedding_status = 'skipped'
  }

  return Response.json({ document: doc })
}
