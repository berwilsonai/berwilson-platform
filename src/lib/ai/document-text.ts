import { callGeminiWithFile } from '@/lib/ai/gemini'
import type { createAdminClient } from '@/lib/supabase/admin'

// Shared full-text extraction for uploaded PDFs. The 2-3 sentence AI summary
// stays (card display), but search quality comes from embedding the complete
// document text. Inline base64 caps out around this size; larger PDFs fall
// back to summary-only embedding.
export const PDF_FULLTEXT_MAX_BYTES = 15 * 1024 * 1024

const FULLTEXT_SYSTEM = `You are a document transcriber for a construction executive intelligence platform.
Extract the COMPLETE text content of this document as clean markdown.
Preserve headings, lists, tables (as markdown tables), dollar figures, dates, names, and section numbering exactly as written.
Do not summarize, skip sections, or add commentary. Output ONLY the extracted text.`

/**
 * Transcribe a PDF's full text via Gemini. Returns null on failure or when
 * the file is too large for an inline pass — callers fall back to embedding
 * the summary, exactly as before.
 */
export async function transcribePdfText(input: {
  dataBase64: string
  byteLength: number
  fileName: string
  userId: string
}): Promise<string | null> {
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
    const text = typeof result.data === 'string' ? result.data.trim() : ''
    return text.length >= 40 ? text : null
  } catch (err) {
    console.error('[document-text] full-text extraction failed:', err)
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
