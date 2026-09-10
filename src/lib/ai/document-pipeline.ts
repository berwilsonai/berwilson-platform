import { callGemini, callGeminiWithFile, UnreadableDocumentError } from '@/lib/ai/gemini'
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
 * Is this document's AI pass unfinished, and therefore worth running again?
 *
 * The two settled states are 'complete' and 'skipped'. Everything else —
 * 'error', 'processing', 'pending', or a row that predates the column — means
 * the pass never reached an end, and the document has a file but no text and no
 * chunks: invisible to the search it was imported for, while change detection
 * correctly reports its bytes as unchanged and never comes back for it.
 *
 * Lives here, next to the statuses it interprets, because every sync that
 * imports documents needs the same answer and one of them not having it is how
 * sixteen company documents sat unreadable indefinitely.
 */
export function needsAnotherPass(status: string | null | undefined): boolean {
  return status !== 'complete' && status !== 'skipped'
}

/**
 * Run the full AI pass on one document and settle its embedding_status.
 *
 * Never throws. The end state distinguishes three things that look alike from
 * the outside: 'complete', 'error' (worth retrying), and 'skipped' (nothing
 * here can read this file, so retrying is waste).
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

    // An empty extraction is not text. Normalized here so the `??` below cannot
    // treat '' as a usable value and try to embed nothing.
    if (!fullText?.trim()) fullText = null

    // 2. Summary. PDFs go through the file path (Gemini needs the file;
    // local mode extracts text itself); docx/text summarize the extracted text.
    //
    // A summary failure must NOT cost the document. Extraction has already
    // succeeded at this point, and the summary is a convenience — the verbatim
    // text is what gets embedded and what Ber AI actually answers from. Letting
    // this throw meant one model hiccup discarded the text as well, leaving a
    // document with a file, no chunks, and an 'error' that nothing came back
    // for: exactly the state fifteen company documents were found in, including
    // the Tooele LOI and a DoD award letter.
    //
    // The one exception is a file nothing here can READ at all, which the PDF
    // path reports as UnreadableDocumentError. That is not a hiccup and there is
    // no text behind it, so it stays fatal and settles the document as skipped.
    let parsed: DocSummary | null = null
    try {
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
    } catch (err) {
      if (err instanceof UnreadableDocumentError || !fullText) throw err
      console.warn(
        `[document-pipeline] summary failed for ${fileName}, indexing the text anyway:`,
        err instanceof Error ? err.message : String(err)
      )
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
      // Neither text nor summary, and step 2 no longer swallows the text on a
      // model hiccup — so this is a file whose content genuinely cannot be read
      // (an empty or image-only docx, a blank export). That is 'skipped', not
      // 'error': both leave it unsearchable, but only one of them invites a
      // nightly sync to fetch and re-read it forever.
      await setStatus(supabase, documentId, 'skipped')
      return { status: 'skipped', aiSummary, confidence }
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
    // A document nothing here can read is SKIPPED, not failed. Both leave it
    // unsearchable, but only one of them is worth trying again — and a nightly
    // sync that cannot tell them apart burns its entire budget re-reading the
    // same scanned survey plats and never reaches the documents behind them.
    if (err instanceof UnreadableDocumentError) {
      console.warn(`[document-pipeline] not indexable (${fileName}): ${err.message}`)
      await setStatus(supabase, documentId, 'skipped')
      return { status: 'skipped', aiSummary: null, confidence: null }
    }
    console.error(`[document-pipeline] AI pass failed (${fileName}):`, err)
    await setStatus(supabase, documentId, 'error')
    return { status: 'error', aiSummary: null, confidence: null }
  }
}
