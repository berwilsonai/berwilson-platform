import { NextRequest } from 'next/server'
import { runDocumentAiPass } from '@/lib/ai/document-pipeline'
import { getViewer, canAccessProject, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'
import { canAccessMeeting } from '@/lib/meetings/access'

// Summary + full-text transcription + embedding can take a few minutes on big PDFs
export const maxDuration = 300

interface InsertBody {
  project_id?: string
  /** Attach the file to a meeting record (audio recording / exhibit). */
  meeting_id?: string
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

  const { project_id, meeting_id, storage_path, file_name, file_size_bytes, mime_type, doc_type, extract_ai } = body

  if ((!project_id && !meeting_id) || !storage_path || !file_name) {
    return Response.json({ error: 'project_id or meeting_id, plus storage_path and file_name, are required' }, { status: 400 })
  }

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) {
    if (meeting_id) {
      const { data: meeting } = await supabase
        .from('meetings')
        .select('scope, project_id')
        .eq('id', meeting_id)
        .maybeSingle()
      if (!meeting || !(await canAccessMeeting(viewer, meeting))) return forbiddenJson()
    } else if (!project_id || !(await canAccessProject(viewer, project_id))) {
      return forbiddenJson()
    }
  }

  // Meeting attachments (audio, exhibits) are pure storage — never AI-embedded
  // here (they carry no valid chunk scope; the meeting's minutes document holds
  // the searchable text).
  const runAi = extract_ai && !meeting_id

  // Insert document record
  const { data: doc, error: insertError } = await supabase
    .from('documents')
    .insert({
      project_id: project_id ?? null,
      meeting_id: meeting_id ?? null,
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

  if (runAi) {
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
        projectId: project_id ?? null,
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
