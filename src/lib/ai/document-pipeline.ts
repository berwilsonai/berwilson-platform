import { callGemini, callGeminiWithFile } from '@/lib/ai/gemini'
import { transcribePdfText, extractDocxText, storeExtractedText } from '@/lib/ai/document-text'
import { embedDocument } from '@/lib/ai/embeddings'
import type { createAdminClient } from '@/lib/supabase/admin'

// Shared AI pass for rows in the `documents` table: summary + full-text
// extraction + embedding, with an honest embedding_status at the end —
// 'complete', 'error', or 'skipped' (file type we can't read). Used by both
// document-upload routes and the reindex route, so a doc can always be
// re-run from storage instead of re-uploaded.

type AdminClient = ReturnType<typeof createAdminClient>

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

const DOC_SUMMARY_SYSTEM = `You are a document analyst for a construction executive intelligence platform.
Summarize the key points of this document in 2-3 sentences. Focus on: parties involved, key obligations or dates, dollar amounts, and critical terms relevant to construction executives.
Return ONLY valid JSON: {"summary": "...", "confidence": 0.0}
confidence is 0.0–1.0 reflecting how clearly this document presents extractable construction intelligence.
Return ONLY valid JSON. No explanation. No markdown.`

export const PDF_MIME_TYPE = 'application/pdf'
export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
])

export type DocumentKind = 'pdf' | 'docx' | 'text' | 'unsupported'

export function documentKind(
  mimeType: string | null | undefined,
  fileName?: string | null
): DocumentKind {
  const mime = mimeType ?? ''
  if (mime === PDF_MIME_TYPE) return 'pdf'
  if (mime === DOCX_MIME_TYPE) return 'docx'
  if (TEXT_MIME_TYPES.has(mime)) return 'text'
  // Fall back on the extension — browsers/Graph sometimes send octet-stream.
  const name = (fileName ?? '').toLowerCase()
  if (name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.docx')) return 'docx'
  if (/\.(txt|md|markdown|csv|html)$/.test(name)) return 'text'
  return 'unsupported'
}

type DocSummary = { summary?: string; confidence?: number } | string

export interface AiPassResult {
  status: 'complete' | 'error' | 'skipped'
  aiSummary: string | null
  confidence: number | null
}

async function setStatus(supabase: AdminClient, documentId: string, status: string) {
  await supabase.from('documents').update({ embedding_status: status }).eq('id', documentId)
}

/**
 * Run the full AI pass on one document and settle its embedding_status.
 * Never throws — every failure path lands on status 'error'.
 */
export async function runDocumentAiPass(input: {
  supabase: AdminClient
  documentId: string
  projectId: string | null
  entityId?: string | null
  isCompany?: boolean
  fileName: string
  mimeType: string | null
  buffer: ArrayBuffer
}): Promise<AiPassResult> {
  const { supabase, documentId, projectId, fileName, mimeType, buffer } = input

  const kind = documentKind(mimeType, fileName)
  if (kind === 'unsupported') {
    await setStatus(supabase, documentId, 'skipped')
    return { status: 'skipped', aiSummary: null, confidence: null }
  }

  try {
    await setStatus(supabase, documentId, 'processing')

    // 1. Full text — what actually gets embedded when available.
    let fullText: string | null = null
    let pdfBase64: string | null = null
    if (kind === 'pdf') {
      pdfBase64 = Buffer.from(buffer).toString('base64')
      fullText = await transcribePdfText({
        dataBase64: pdfBase64,
        byteLength: buffer.byteLength,
        fileName,
        userId: SYSTEM_USER_ID,
      })
    } else if (kind === 'docx') {
      fullText = await extractDocxText(buffer)
    } else {
      fullText = new TextDecoder().decode(buffer)
    }

    // 2. Summary. PDFs go through the file path (Gemini needs the file;
    // local mode extracts text itself); docx/text summarize the extracted text.
    let parsed: DocSummary | null = null
    if (kind === 'pdf') {
      const result = await callGeminiWithFile<DocSummary>({
        systemPrompt: DOC_SUMMARY_SYSTEM,
        prompt: 'Summarize this document.',
        file: { mimeType: PDF_MIME_TYPE, dataBase64: pdfBase64! },
        userId: SYSTEM_USER_ID,
        logLabel: `Document summary: ${fileName}`,
        promptVersion: 'doc-summary-1.0',
        maxTokens: 2048, // Gemini-path cap only; local mode ignores maxTokens (unbudgeted)
      })
      parsed = result.data
    } else if (fullText) {
      const result = await callGemini<DocSummary>({
        task: 'doc-summary',
        systemPrompt: DOC_SUMMARY_SYSTEM,
        userMessage: fullText.slice(0, 30000),
        userId: SYSTEM_USER_ID,
        promptVersion: 'doc-summary-1.0',
        maxTokens: 2048,
      })
      parsed = result.data
    }

    let aiSummary: string | null = null
    let confidence: number | null = null
    if (parsed && typeof parsed === 'object') {
      aiSummary = parsed.summary?.trim() || null
      confidence = parsed.confidence ?? null
    } else if (parsed) {
      aiSummary = String(parsed).trim().slice(0, 1000) || null
    }
    if (aiSummary) {
      await supabase
        .from('documents')
        .update({ ai_summary: aiSummary, confidence })
        .eq('id', documentId)
    }
    if (fullText) {
      await storeExtractedText(supabase, 'documents', documentId, fullText)
    }

    // 3. Embed — full text when we have it, summary as the fallback.
    const embedText = fullText ?? aiSummary
    if (!embedText) {
      await setStatus(supabase, documentId, 'error')
      return { status: 'error', aiSummary, confidence }
    }
    const ok = await embedDocument(
      documentId,
      projectId,
      embedText,
      input.entityId ?? null,
      input.isCompany ?? false
    )
    return { status: ok ? 'complete' : 'error', aiSummary, confidence }
  } catch (err) {
    console.error(`[document-pipeline] AI pass failed (${fileName}):`, err)
    await setStatus(supabase, documentId, 'error')
    return { status: 'error', aiSummary: null, confidence: null }
  }
}
