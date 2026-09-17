import { createAdminClient } from '@/lib/supabase/admin'
import { runDocumentAiPass } from '@/lib/ai/document-pipeline'

/**
 * Email-intake attachment staging.
 *
 * The email-research run saves every qualifying Gmail attachment to the
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
 * extraction + embedding, best-effort (PDF, docx, and text files; other
 * types stay as plain stored files). Run sequentially (local model).
 *
 * Both document tables go through the SAME pass. This used to be two: a call
 * into runDocumentAiPass for project documents and a hand-rolled copy here for
 * opportunity ones. The copy summarized BEFORE storing the extracted text, so a
 * summary that threw took the text with it — the exact defect fixed in
 * document-pipeline.ts on 2026-09-09, which never reached this second copy.
 * Pointed at a real opportunity it discarded 413,000 characters of readable
 * text across three technical reports while reporting nothing wrong.
 */
export async function processPromotedDocumentAi(doc: PromotedDocument): Promise<void> {
  const supabase = createAdminClient()
  try {
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('documents')
      .download(doc.storagePath)
    if (downloadError || !fileBlob) return
    const buffer = await fileBlob.arrayBuffer()

    await runDocumentAiPass({
      supabase,
      documentId: doc.id,
      projectId: doc.table === 'documents' ? doc.parentId : null,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      buffer,
      target:
        doc.table === 'opportunity_documents'
          ? { table: 'opportunity_documents', opportunityId: doc.parentId }
          : { table: 'documents' },
    })
  } catch (err) {
    // Best-effort — the document row exists either way.
    console.error(`[email-intake] AI pass failed (${doc.fileName}):`, err)
  }
}
