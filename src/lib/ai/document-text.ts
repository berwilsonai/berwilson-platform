import { callGeminiWithFile } from '@/lib/ai/gemini'
import { isLocalAI, extractPdfText } from '@/lib/ai/local'
import type { createAdminClient } from '@/lib/supabase/admin'

// Shared full-text extraction for uploaded PDFs. The 2-3 sentence AI summary
// stays (card display), but search quality comes from embedding the complete
// document text.
//
// The size ceiling is PER PATH, because the two paths are limited by different
// things. Gemini receives the whole file base64-inlined in the request, so it
// caps out around 15MB. Local mode makes no request at all — `unpdf` reads the
// buffer in process — so the only real constraint is memory, and applying the
// API's ceiling there silently cost real documents: a 20.5MB technical report
// holding 50,000 characters of readable text was stored with a summary and no
// text, which is the difference between Ber AI quoting a report and merely
// knowing it exists.
export const PDF_FULLTEXT_MAX_BYTES = 15 * 1024 * 1024
export const PDF_FULLTEXT_MAX_BYTES_LOCAL = 100 * 1024 * 1024

// Postgres text/jsonb rejects NUL bytes ("unsupported Unicode escape
// sequence") and lone surrogates — PDFs with embedded fonts produce both.
function sanitizeExtractedText(text: string): string {
  return text.replace(/\u0000/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
}

const FULLTEXT_SYSTEM = `You are a document transcriber for a construction executive intelligence platform.
Extract the COMPLETE text content of this document as clean markdown.
Preserve headings, lists, tables (as markdown tables), dollar figures, dates, names, and section numbering exactly as written.
Do not summarize, skip sections, or add commentary. Output ONLY the extracted text.`

/**
 * Transcribe a PDF's full text. Returns null on failure or when the file is
 * beyond the active path's ceiling — callers fall back to embedding the
 * summary, exactly as before.
 */
export async function transcribePdfText(input: {
  dataBase64: string
  byteLength: number
  fileName: string
  userId: string
}): Promise<string | null> {
  // Local mode: extract the text directly — no model pass needed for a
  // verbatim transcription, and nothing leaves the machine.
  if (isLocalAI()) {
    if (input.byteLength > PDF_FULLTEXT_MAX_BYTES_LOCAL) return null
    const raw = await extractPdfText(input.dataBase64)
    const text = raw ? sanitizeExtractedText(raw) : null
    return text && text.length >= 40 ? text : null
  }

  if (input.byteLength > PDF_FULLTEXT_MAX_BYTES) return null

  try {
    const result = await callGeminiWithFile<string>({
      systemPrompt: FULLTEXT_SYSTEM,
      prompt: 'Extract the full text of this document.',
      file: { mimeType: 'application/pdf', dataBase64: input.dataBase64 },
      userId: input.userId,
      logLabel: `Document full text: ${input.fileName}`,
      promptVersion: 'doc-fulltext-1.0',
      jsonMode: false,
      maxTokens: 60000,
    })
    const text = typeof result.data === 'string' ? sanitizeExtractedText(result.data.trim()) : ''
    return text.length >= 40 ? text : null
  } catch (err) {
    console.error('[document-text] full-text extraction failed:', err)
    return null
  }
}

/**
 * Extract the text of a .docx file (Word). Returns null on failure or when
 * the document has no meaningful text — callers mark the doc unindexable.
 */
export async function extractDocxText(buffer: ArrayBuffer): Promise<string | null> {
  try {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) })
    const text = sanitizeExtractedText(result.value?.trim() ?? '')
    return text.length >= 40 ? text : null
  } catch (err) {
    console.error('[document-text] docx extraction failed:', err)
    return null
  }
}

/**
 * Persist extracted text onto a document row. Tolerant of the migration
 * window: if the extracted_text column doesn't exist yet (20260703000001 not
 * applied), the write is skipped silently — the text is still embedded.
 */
export async function storeExtractedText(
  supabase: ReturnType<typeof createAdminClient>,
  table: 'documents' | 'opportunity_documents',
  id: string,
  text: string
): Promise<void> {
  const { error } = await supabase.from(table).update({ extracted_text: text }).eq('id', id)
  if (error && !(error.code === 'PGRST204' || /extracted_text/i.test(error.message))) {
    console.error(`[document-text] failed to store extracted_text on ${table}:`, error.message)
  }
}
