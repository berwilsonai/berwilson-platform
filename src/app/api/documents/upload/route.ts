import { NextRequest } from 'next/server'
import { runDocumentAiPass } from '@/lib/ai/document-pipeline'
import { getViewer, canAccessProject, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'

// Summary + full-text transcription + embedding can take a few minutes on big PDFs
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const supabase = await actorAdminClient()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const project_id = formData.get('project_id') as string | null
  const entity_id = formData.get('entity_id') as string | null
  const is_company = formData.get('is_company') === 'true'
  const doc_type = (formData.get('doc_type') as string) ?? 'other'
  const extract_ai = formData.get('extract_ai') === 'true'

  if (!file || (!project_id && !entity_id && !is_company)) {
    return Response.json({ error: 'file and one of project_id, entity_id, or is_company are required' }, { status: 400 })
  }

  // Scoped users may only upload into their granted projects (never entity/company docs).
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) {
    if (!project_id || entity_id || is_company || !(await canAccessProject(viewer, project_id))) {
      return forbiddenJson()
    }
  }

  // Build storage path
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = is_company && !project_id && !entity_id
    ? `company/${timestamp}_${safeName}`
    : entity_id && !project_id
    ? `entities/${entity_id}/${timestamp}_${safeName}`
    : `projects/${project_id}/${timestamp}_${safeName}`

  // Upload to storage using admin client — bypasses RLS entirely
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

  // Insert document record
  const basePayload = {
    project_id: project_id || null,
    entity_id: entity_id || null,
    storage_path: storagePath,
    file_name: file.name,
    file_size_bytes: file.size,
    mime_type: file.type || null,
    doc_type,
    source: 'document' as const,
  }

  let { data: doc, error: insertError } = await supabase
    .from('documents')
    .insert({ ...basePayload, is_company })
    .select()
    .single()

  // Migration-window fallback: if the is_company column doesn't exist yet
  // (migration 20260625000002 not applied), insert without it so existing
  // project/entity/site uploads keep working. Company uploads need the migration.
  if (insertError && (insertError.code === 'PGRST204' || /is_company/i.test(insertError.message))) {
    ;({ data: doc, error: insertError } = await supabase
      .from('documents')
      .insert(basePayload)
      .select()
      .single())
  }

  if (insertError || !doc) {
    return Response.json({ error: insertError?.message ?? 'Insert failed' }, { status: 500 })
  }

  if (extract_ai) {
    // Never throws — settles embedding_status to complete/error/skipped.
    const result = await runDocumentAiPass({
      supabase,
      documentId: doc.id,
      projectId: project_id,
      entityId: entity_id,
      isCompany: is_company,
      fileName: file.name,
      mimeType: file.type || null,
      buffer: fileBuffer,
    })
    doc.ai_summary = result.aiSummary ?? doc.ai_summary
    doc.confidence = result.confidence ?? doc.confidence
    doc.embedding_status = result.status
  } else {
    // No AI requested — don't leave the doc looking like it's indexing.
    await supabase.from('documents').update({ embedding_status: 'skipped' }).eq('id', doc.id)
    doc.embedding_status = 'skipped'
  }

  return Response.json({ document: doc })
}
