import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callGemini, callGeminiWithFile } from '@/lib/ai/gemini'
import { transcribePdfText, extractDocxText, storeExtractedText } from '@/lib/ai/document-text'
import { documentKind } from '@/lib/ai/document-pipeline'
import { embedOpportunityDocument } from '@/lib/ai/embeddings'
import { getViewer, canAccessOpportunity, forbiddenJson } from '@/lib/auth/viewer'

// Summary + full-text transcription + embedding can take a few minutes on big PDFs
export const maxDuration = 300

type DocSummary = { summary?: string } | string

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

const DOC_SUMMARY_SYSTEM = `You are an analyst for a construction & development holding company evaluating strategic opportunities (acquisitions, partnerships, JVs, investments).
Summarize the key points of this document in 2-3 sentences. Focus on: what the company/asset is, financial highlights (revenue, EBITDA, valuation, deal terms), strategic fit, and any flagged risks.
Return ONLY valid JSON: {"summary": "..."}
No explanation. No markdown.`

const PDF_MIME_TYPE = 'application/pdf'

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
  if (viewer && !viewer.isAdmin && !canAccessOpportunity(viewer, opportunity_id)) return forbiddenJson()

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

  // Optional AI summary (best-effort; the document is saved regardless)
  const docKind = documentKind(file.type, file.name)
  if (extract_ai && docKind !== 'unsupported') {
    try {
      let parsed: DocSummary | null = null
      let fullTextContent: string | null = null

      if (docKind === 'pdf') {
        const base64 = Buffer.from(fileBuffer).toString('base64')
        const result = await callGeminiWithFile<DocSummary>({
          systemPrompt: DOC_SUMMARY_SYSTEM,
          prompt: 'Summarize this document.',
          file: { mimeType: PDF_MIME_TYPE, dataBase64: base64 },
          userId: SYSTEM_USER_ID,
          logLabel: `Opportunity doc summary: ${file.name}`,
          promptVersion: 'opp-doc-summary-1.0',
          maxTokens: 2048, // Gemini-path cap only; local mode ignores maxTokens (unbudgeted)
        })
        parsed = result.data
        // Second pass: full-text transcription so CIMs/teasers/white papers are
        // searchable by content from /intel and the agent.
        fullTextContent = await transcribePdfText({
          dataBase64: base64,
          byteLength: fileBuffer.byteLength,
          fileName: file.name,
          userId: SYSTEM_USER_ID,
        })
      } else {
        fullTextContent =
          docKind === 'docx'
            ? await extractDocxText(fileBuffer)
            : new TextDecoder().decode(fileBuffer)
        if (fullTextContent) {
          const result = await callGemini<DocSummary>({
            task: 'opp-doc-summary',
            systemPrompt: DOC_SUMMARY_SYSTEM,
            userMessage: fullTextContent.slice(0, 30000),
            userId: SYSTEM_USER_ID,
            promptVersion: 'opp-doc-summary-1.0',
            maxTokens: 2048, // Gemini-path cap only; local mode ignores maxTokens (unbudgeted)
          })
          parsed = result.data
        }
      }

      const summary =
        parsed && typeof parsed === 'object' ? parsed.summary ?? null : String(parsed ?? '').slice(0, 1000)
      if (summary) {
        await supabase.from('opportunity_documents').update({ ai_summary: summary }).eq('id', doc.id)
        doc.ai_summary = summary
      }

      if (fullTextContent) {
        await storeExtractedText(supabase, 'opportunity_documents', doc.id, fullTextContent)
      }
      // Embed full text when available, else the summary — degrades to a
      // warn+skip until migration 20260703000001 is applied.
      const embedText = fullTextContent ?? summary
      if (embedText) {
        embedOpportunityDocument(doc.id, opportunity_id, embedText).catch(console.error)
      }
    } catch {
      // AI summary failed — document is still saved
    }
  }

  return Response.json({ document: doc })
}
