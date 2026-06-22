import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedDocument } from '@/lib/ai/embeddings'
import { callGemini, callGeminiWithFile } from '@/lib/ai/gemini'

type DocSummary = { summary?: string; confidence?: number } | string

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

const DOC_SUMMARY_SYSTEM = `You are a document analyst for a construction executive intelligence platform.
Summarize the key points of this document in 2-3 sentences. Focus on: parties involved, key obligations or dates, dollar amounts, and critical terms relevant to construction executives.
Return ONLY valid JSON: {"summary": "...", "confidence": 0.0}
confidence is 0.0–1.0 reflecting how clearly this document presents extractable construction intelligence.
Return ONLY valid JSON. No explanation. No markdown.`

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
])

const PDF_MIME_TYPE = 'application/pdf'

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
  const supabase = createAdminClient()

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

  // Optionally run AI extraction
  if (extract_ai && (TEXT_MIME_TYPES.has(mime_type) || mime_type === PDF_MIME_TYPE)) {
    try {
      // Download file from storage
      const { data: fileBlob, error: downloadError } = await supabase.storage
        .from('documents')
        .download(storage_path)

      if (!downloadError && fileBlob) {
        let parsed: DocSummary
        let fullTextContent: string | null = null  // captured for text file embedding

        if (mime_type === PDF_MIME_TYPE) {
          // Gemini's native PDF support
          const buffer = await fileBlob.arrayBuffer()
          const base64 = Buffer.from(buffer).toString('base64')

          const result = await callGeminiWithFile<DocSummary>({
            systemPrompt: DOC_SUMMARY_SYSTEM,
            prompt: 'Summarize this document.',
            file: { mimeType: PDF_MIME_TYPE, dataBase64: base64 },
            userId: SYSTEM_USER_ID,
            logLabel: `Document summary: ${file_name}`,
            promptVersion: 'doc-summary-1.0',
            maxTokens: 512,
          })
          parsed = result.data
        } else {
          // Text file — read as string
          const text = await fileBlob.text()
          fullTextContent = text  // capture for embedding (full content, not truncated)

          const result = await callGemini<DocSummary>({
            task: 'doc-summary',
            systemPrompt: DOC_SUMMARY_SYSTEM,
            userMessage: text.slice(0, 30000), // stay within token budget
            userId: SYSTEM_USER_ID,
            promptVersion: 'doc-summary-1.0',
            maxTokens: 512,
          })
          parsed = result.data
        }

        // Update document record
        let embedText: string | null = null
        if (parsed && typeof parsed === 'object') {
          await supabase
            .from('documents')
            .update({
              ai_summary: parsed.summary ?? null,
              confidence: parsed.confidence ?? null,
            })
            .eq('id', doc.id)

          doc.ai_summary = parsed.summary ?? null
          doc.confidence = parsed.confidence ?? null
          // Text files: embed full content. PDFs: embed AI summary.
          if (fullTextContent) {
            embedText = fullTextContent
          } else if (mime_type === PDF_MIME_TYPE && parsed.summary) {
            embedText = parsed.summary
          }
        } else {
          // AI returned non-JSON — store raw text as summary
          const raw = String(parsed ?? '')
          await supabase
            .from('documents')
            .update({ ai_summary: raw.slice(0, 1000) })
            .eq('id', doc.id)
          doc.ai_summary = raw.slice(0, 1000)
          // Still embed whatever text we have for text files
          if (fullTextContent) embedText = fullTextContent
        }

        if (embedText) {
          embedDocument(doc.id, project_id, embedText).catch(console.error)
        }
      }
    } catch {
      // AI extraction failed — document is still saved, just no summary
    }
  }

  return Response.json({ document: doc })
}
