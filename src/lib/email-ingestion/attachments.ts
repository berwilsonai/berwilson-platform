import { createAdminClient } from '@/lib/supabase/admin'
import { callGemini, callGeminiWithFile } from '@/lib/ai/gemini'
import { transcribePdfText, storeExtractedText } from '@/lib/ai/document-text'
import { embedDocument, embedOpportunityDocument } from '@/lib/ai/embeddings'

/**
 * Email-intake attachment staging.
 *
 * The email-research run saves every qualifying Outlook attachment to the
 * documents bucket under email-intake/{sessionId}/… and records the list on
 * `email_intake_sessions.staged_attachments`. The review screen offers a
 * picker; confirm promotes the selected files into the created record's
 * documents (storage copy + documents / opportunity_documents row + the same
 * AI summary/transcription/embedding pass the upload routes run) and the
 * staging folder is cleared on confirm or dismiss.
 */

export const STAGING_FOLDER = 'email-intake'

export interface StagedAttachment {
  name: string
  mime_type: string | null
  size_bytes: number
  storage_path: string
  /** Subject of the thread the attachment arrived on. */
  thread_subject: string
  /** Whether the run's AI pass extracted this attachment's content into the report. */
  analyzed: boolean
}

/** Tolerant parse of the jsonb column (absent pre-migration → []). */
export function parseStagedAttachments(value: unknown): StagedAttachment[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (a): a is StagedAttachment =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as StagedAttachment).name === 'string' &&
      typeof (a as StagedAttachment).storage_path === 'string' &&
      (a as StagedAttachment).storage_path.startsWith(`${STAGING_FOLDER}/`)
  )
}

/** Best-effort removal of a session's staged files (confirm promotes copies first). */
export async function removeStagedFiles(
  supabase: ReturnType<typeof createAdminClient>,
  attachments: StagedAttachment[]
): Promise<void> {
  if (attachments.length === 0) return
  const { error } = await supabase.storage
    .from('documents')
    .remove(attachments.map((a) => a.storage_path))
  if (error) console.error('[email-intake] staging cleanup failed:', error.message)
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

// ---------------------------------------------------------------------------
// Confirm-time promotion: staged file → real document on the created record
// ---------------------------------------------------------------------------

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'
const PDF_MIME_TYPE = 'application/pdf'
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'text/html'])

// Mirrors the doc-summary prompts in api/documents + api/opportunities/documents.
const DOC_SUMMARY_SYSTEM = `You are a document analyst for a construction executive intelligence platform.
Summarize the key points of this document in 2-3 sentences. Focus on: parties involved, key obligations or dates, dollar amounts, and critical terms relevant to construction executives.
Return ONLY valid JSON: {"summary": "..."}
No explanation. No markdown.`

export interface PromotedDocument {
  table: 'documents' | 'opportunity_documents'
  id: string
  parentId: string
  storagePath: string
  fileName: string
  mimeType: string | null
}

export interface PromoteTarget {
  kind: 'project' | 'opportunity'
  id: string
}

/**
 * Copy one staged attachment into the record's document area and insert its
 * document row. Returns the inserted row's identity (for the async AI pass),
 * or null if the copy/insert failed — a bad attachment never blocks confirm.
 */
export async function promoteStagedAttachment(
  supabase: ReturnType<typeof createAdminClient>,
  attachment: StagedAttachment,
  target: PromoteTarget,
  index: number
): Promise<PromotedDocument | null> {
  const safeName = sanitizeFileName(attachment.name)
  const destPath =
    target.kind === 'project'
      ? `projects/${target.id}/${Date.now()}_${index}_${safeName}`
      : `opportunities/${target.id}/${Date.now()}_${index}_${safeName}`

  const { error: copyError } = await supabase.storage
    .from('documents')
    .copy(attachment.storage_path, destPath)
  if (copyError) {
    console.error(`[email-intake] attachment copy failed (${attachment.name}):`, copyError.message)
    return null
  }

  if (target.kind === 'project') {
    const { data, error } = await supabase
      .from('documents')
      .insert({
        project_id: target.id,
        storage_path: destPath,
        file_name: attachment.name,
        file_size_bytes: attachment.size_bytes,
        mime_type: attachment.mime_type,
        doc_type: 'other',
        source: 'document',
      })
      .select('id')
      .single()
    if (error || !data) {
      console.error(`[email-intake] document insert failed (${attachment.name}):`, error?.message)
      return null
    }
    return {
      table: 'documents',
      id: data.id,
      parentId: target.id,
      storagePath: destPath,
      fileName: attachment.name,
      mimeType: attachment.mime_type,
    }
  }

  const { data, error } = await supabase
    .from('opportunity_documents')
    .insert({
      opportunity_id: target.id,
      storage_path: destPath,
      file_name: attachment.name,
      file_size_bytes: attachment.size_bytes,
      mime_type: attachment.mime_type,
      doc_type: 'other',
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error(`[email-intake] opportunity document insert failed (${attachment.name}):`, error?.message)
    return null
  }
  return {
    table: 'opportunity_documents',
    id: data.id,
    parentId: target.id,
    storagePath: destPath,
    fileName: attachment.name,
    mimeType: attachment.mime_type,
  }
}

/**
 * The post-insert AI pass the upload routes run: summary + full-text
 * transcription + embedding, best-effort. PDFs and text files only — other
 * types stay as plain stored files. Run sequentially (local model).
 */
export async function processPromotedDocumentAi(doc: PromotedDocument): Promise<void> {
  const mime = doc.mimeType ?? ''
  if (mime !== PDF_MIME_TYPE && !TEXT_MIME_TYPES.has(mime)) return

  const supabase = createAdminClient()
  try {
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('documents')
      .download(doc.storagePath)
    if (downloadError || !fileBlob) return

    let summaryRaw: { summary?: string } | string
    let fullTextContent: string | null = null

    if (mime === PDF_MIME_TYPE) {
      const buffer = await fileBlob.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      const result = await callGeminiWithFile<{ summary?: string } | string>({
        systemPrompt: DOC_SUMMARY_SYSTEM,
        prompt: 'Summarize this document.',
        file: { mimeType: PDF_MIME_TYPE, dataBase64: base64 },
        userId: SYSTEM_USER_ID,
        logLabel: `Email intake doc summary: ${doc.fileName}`,
        promptVersion: 'doc-summary-1.0',
        // Local Qwen spends reasoning tokens inside this budget — 512 gets
        // fully consumed by reasoning and returns an empty summary.
        maxTokens: 2048,
      })
      summaryRaw = result.data
      fullTextContent = await transcribePdfText({
        dataBase64: base64,
        byteLength: buffer.byteLength,
        fileName: doc.fileName,
        userId: SYSTEM_USER_ID,
      })
    } else {
      const text = await fileBlob.text()
      fullTextContent = text
      const result = await callGemini<{ summary?: string } | string>({
        task: 'doc-summary',
        systemPrompt: DOC_SUMMARY_SYSTEM,
        userMessage: text.slice(0, 30000),
        userId: SYSTEM_USER_ID,
        promptVersion: 'doc-summary-1.0',
        maxTokens: 2048,
      })
      summaryRaw = result.data
    }

    const summary =
      summaryRaw && typeof summaryRaw === 'object'
        ? summaryRaw.summary ?? null
        : String(summaryRaw ?? '').slice(0, 1000) || null
    if (summary) {
      await supabase.from(doc.table).update({ ai_summary: summary }).eq('id', doc.id)
    }
    if (fullTextContent) {
      await storeExtractedText(supabase, doc.table, doc.id, fullTextContent)
    }

    const embedText = fullTextContent ?? summary
    if (embedText) {
      if (doc.table === 'documents') {
        await embedDocument(doc.id, doc.parentId, embedText)
      } else {
        await embedOpportunityDocument(doc.id, doc.parentId, embedText)
      }
    }
  } catch (err) {
    // Best-effort — the document row exists either way.
    console.error(`[email-intake] AI pass failed (${doc.fileName}):`, err)
  }
}
