import { NextRequest } from 'next/server'
import { runDocumentAiPass } from '@/lib/ai/document-pipeline'
import { getViewer, actorAdminClient, forbiddenJson } from '@/lib/auth/viewer'

// Store the file, create a reference document, and run the full AI pass
// (summary + full-text extraction + embedding) so it can be digested and asked
// about. Can take a few minutes on large PDFs.
export const maxDuration = 300

export async function POST(request: NextRequest) {
  // Reference documents are an admin-only surface (default-deny).
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  const supabase = await actorAdminClient()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const title = ((formData.get('title') as string) || '').trim()

  if (!file) {
    return Response.json({ error: 'A file is required' }, { status: 400 })
  }

  // 200MB cap — matches the proposal intake guard, keeps extraction sane.
  const MAX_FILE_BYTES = 200 * 1024 * 1024
  if (file.size > MAX_FILE_BYTES) {
    return Response.json(
      { error: `${file.name} is ${Math.round(file.size / 1024 / 1024)}MB — max is 200MB.` },
      { status: 400 }
    )
  }

  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `reference/${timestamp}_${safeName}`
  const fileBuffer = await file.arrayBuffer()

  const { error: storageError } = await supabase.storage
    .from('documents')
    .upload(storagePath, fileBuffer, {
      contentType: file.type || 'application/octet-stream',
      cacheControl: '3600',
      upsert: false,
    })

  if (storageError) {
    return Response.json({ error: storageError.message }, { status: 500 })
  }

  const { data: doc, error: insertError } = await supabase
    .from('documents')
    .insert({
      is_reference: true,
      storage_path: storagePath,
      // Title is what the reader shows; fall back to the file name.
      file_name: title || file.name,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      doc_type: 'reference',
      source: 'document' as const,
    })
    .select('id')
    .single()

  if (insertError || !doc) {
    // Clean up the orphaned storage object so a failed insert doesn't strand it.
    await supabase.storage.from('documents').remove([storagePath]).catch(() => {})
    return Response.json({ error: insertError?.message ?? 'Insert failed' }, { status: 500 })
  }

  // Full AI pass — never throws; settles embedding_status to complete/error/skipped.
  const result = await runDocumentAiPass({
    supabase,
    documentId: doc.id,
    projectId: null,
    entityId: null,
    isCompany: false,
    fileName: file.name,
    mimeType: file.type || null,
    buffer: fileBuffer,
  })

  return Response.json({ id: doc.id, status: result.status })
}
