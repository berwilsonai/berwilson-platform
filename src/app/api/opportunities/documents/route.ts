import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { documentKind, runDocumentAiPass } from '@/lib/ai/document-pipeline'
import { getViewer, canAccessOpportunity, forbiddenJson } from '@/lib/auth/viewer'

// Summary + full-text transcription + embedding can take a few minutes on big PDFs
export const maxDuration = 300

const OPPORTUNITY_DOC_SUMMARY = `You are an analyst for a construction & development holding company evaluating strategic opportunities (acquisitions, partnerships, JVs, investments).
Summarize the key points of this document in 2-3 sentences. Focus on: what the company/asset is, financial highlights (revenue, EBITDA, valuation, deal terms), strategic fit, and any flagged risks.
Return ONLY valid JSON: {"summary": "..."}
No explanation. No markdown.`

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const opportunity_id = formData.get('opportunity_id') as string | null
  const doc_type = (formData.get('doc_type') as string) ?? 'white_paper'
  const extract_ai = formData.get('extract_ai') === 'true'

  if (!file || !opportunity_id) {
    return Response.json({ error: 'file and opportunity_id are required' }, { status: 400 })
  }

  const viewer = await getViewer()
  if (!viewer || (!viewer.isAdmin && !canAccessOpportunity(viewer, opportunity_id))) return forbiddenJson()

  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `opportunities/${opportunity_id}/${timestamp}_${safeName}`

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
    .from('opportunity_documents')
    .insert({
      opportunity_id,
      storage_path: storagePath,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      doc_type,
    })
    .select()
    .single()

  if (insertError || !doc) {
    return Response.json({ error: insertError?.message ?? 'Insert failed' }, { status: 500 })
  }

  // ⚠ THIS USED TO BE A SECOND COPY OF THE DOCUMENT AI PASS, and it is the
  // copy `document-pipeline.ts` warns about: "never fork this pass per table;
  // add a target." It summarized BEFORE storing the extracted text and wrapped
  // everything in a bare `catch {}`, so a summary hiccup discarded the text
  // too — the 2026-09-09 failure, which cost 413,000 characters the first time
  // it was pointed at real files. It also never settled `embedding_status`, so
  // an opportunity document could not be seen as stranded and was never
  // retried.
  //
  // The shared pass does all of that correctly, embeds through
  // embedOpportunityDocument via its target, and keeps the opportunity-specific
  // summary framing as a parameter.
  const docKind = documentKind(file.type, file.name)
  if (extract_ai && docKind !== 'unsupported') {
    const result = await runDocumentAiPass({
      supabase,
      documentId: doc.id,
      projectId: null,
      fileName: file.name,
      mimeType: file.type || null,
      buffer: fileBuffer,
      target: { table: 'opportunity_documents', opportunityId: opportunity_id },
      summaryPrompt: OPPORTUNITY_DOC_SUMMARY,
      promptVersion: 'opp-doc-summary-1.0',
    })
    if (result.aiSummary) doc.ai_summary = result.aiSummary
  }

  return Response.json({ document: doc })
}
