/**
 * Drive folder → project documents.
 *
 * The inbound half of the Drive integration. `publish.ts` pushes documents OUT
 * so people who cannot reach the tailnet can read them; this pulls a deal folder
 * IN so its contents become searchable evidence Ber AI can cite and the fit
 * assessor can ground on.
 *
 * Modeled on syncDriveKnowledge (src/lib/knowledge/drive-sync.ts) rather than
 * written fresh: change detection by (drive_file_id, drive_modified_at) is the
 * same problem, and that version has been running nightly since August. The
 * differences are that documents land on a project instead of the company
 * knowledge base, and that imported files are stamped as already-published so
 * the publish reconcile never pushes a file back into the folder it came from.
 *
 * Runs at three moments: once when a lead is promoted, nightly for anything the
 * team added during diligence, and on demand behind a button.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { runDocumentAiPass, documentKind } from '@/lib/ai/document-pipeline'
import {
  listFolder,
  fetchDriveFile,
  driveFileUnchanged,
  type DriveFile,
} from '@/lib/integrations/google-drive'
import { MANIFEST_NAME } from '@/lib/deal-intake/parse'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'

/** Nothing bigger. A 100MB site walkthrough video is not a document. */
const MAX_FILE_BYTES = 30 * 1024 * 1024

export interface DriveImportResult {
  seen: number
  added: number
  updated: number
  unchanged: number
  skipped: number
  failed: number
  errors: string[]
  outOfTime: boolean
}

interface KnownDoc {
  id: string
  drive_file_id: string
  drive_modified_at: string | null
}

/** Google Docs arrive as an unsupported mime but export to text — keep them. */
function exportable(file: DriveFile): boolean {
  return file.mimeType === 'application/vnd.google-apps.document'
}

export async function importDriveFolder(opts: {
  folderId: string
  projectId: string
  budgetMs?: number
  /** doc_type for newly imported rows. Diligence packages are the default. */
  docType?: string
}): Promise<DriveImportResult> {
  const { folderId, projectId } = opts
  const deadline = Date.now() + (opts.budgetMs ?? 10 * 60 * 1000)
  const docType = opts.docType ?? 'diligence'
  const supabase = createAdminClient()

  const result: DriveImportResult = {
    seen: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    outOfTime: false,
  }

  const files = await listFolder(folderId)
  result.seen = files.length

  // Scoped to this project: the same Drive file could legitimately be imported
  // onto two projects, and a global map would make the second look unchanged.
  const { data: existingRows } = await supabase
    .from('documents')
    .select('id, drive_file_id, drive_modified_at')
    .eq('project_id', projectId)
    .not('drive_file_id', 'is', null)

  const known = new Map<string, KnownDoc>()
  for (const row of (existingRows ?? []) as KnownDoc[]) {
    known.set(row.drive_file_id, row)
  }

  for (const file of files) {
    if (Date.now() >= deadline) {
      result.outOfTime = true
      break
    }

    // The manifest is the transport, not a document. It is already stored whole
    // on the lead as intake_answers and rendered as diligence items.
    if (file.name === MANIFEST_NAME) {
      result.skipped++
      continue
    }

    const prior = known.get(file.id)
    // Drive's modifiedTime changes on any edit — same instant means nothing to do.
    if (prior && driveFileUnchanged(prior.drive_modified_at, file)) {
      result.unchanged++
      continue
    }

    if (file.size != null && file.size > MAX_FILE_BYTES) {
      result.skipped++
      continue
    }
    if (documentKind(file.mimeType, file.name) === 'unsupported' && !exportable(file)) {
      result.skipped++
      continue
    }

    try {
      const content = await fetchDriveFile(file)
      if (!content) {
        result.skipped++
        continue
      }

      const safeName = content.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `projects/${projectId}/drive/${file.id}-${safeName}`
      const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(path, content.buffer, { contentType: content.mimeType, upsert: true })
      if (upErr) throw new Error(upErr.message)

      let documentId: string
      if (prior) {
        // Drop the old chunks BEFORE re-indexing, or the previous revision keeps
        // answering questions alongside the new one.
        await supabase.from('chunks').delete().eq('document_id', prior.id)
        const { error } = await supabase
          .from('documents')
          .update({
            storage_path: path,
            file_name: content.fileName,
            mime_type: content.mimeType,
            file_size_bytes: file.size,
            drive_modified_at: file.modifiedTime,
            embedding_status: 'pending',
            extracted_text: null,
            ai_summary: null,
          })
          .eq('id', prior.id)
        if (error) throw new Error(error.message)
        documentId = prior.id
        result.updated++
      } else {
        const { data, error } = await supabase
          .from('documents')
          .insert({
            project_id: projectId,
            storage_path: path,
            file_name: content.fileName,
            mime_type: content.mimeType,
            file_size_bytes: file.size,
            doc_type: docType,
            drive_file_id: file.id,
            drive_modified_at: file.modifiedTime,
            // Already in the project's Drive folder — it is where it came from.
            // Without this, reconcileDrivePublishing would upload every imported
            // file straight back into the folder it was read from.
            drive_published_id: file.id,
          })
          .select('id')
          .single()
        if (error) throw new Error(error.message)
        documentId = data.id
        result.added++
      }

      // Settles embedding_status itself and never throws.
      await runDocumentAiPass({
        supabase,
        documentId,
        projectId,
        fileName: content.fileName,
        mimeType: content.mimeType,
        buffer: content.buffer,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[drive/import] ${file.name} failed:`, message)
      result.errors.push(`${file.name}: ${message.slice(0, 200)}`)
      result.failed++
    }
  }

  return result
}

/**
 * Read a Drive folder's document text without storing anything.
 *
 * Used when scoring a web-form lead: the fit assessor needs the evidence, but
 * the lead may never be promoted, and staging every submission's files into the
 * documents bucket would pay storage for deals that are passed on. The files are
 * imported once, at promotion.
 */
export async function readDriveFolderText(
  folderId: string,
  opts: { maxFiles?: number; maxBytes?: number } = {}
): Promise<{ text: string; filesRead: number; fileNames: string[] }> {
  const maxFiles = opts.maxFiles ?? 8
  const maxBytes = opts.maxBytes ?? 15 * 1024 * 1024
  const chunks: string[] = []
  const fileNames: string[] = []

  // Imported lazily: this path is only reached in the lead score phase, and
  // pulling the PDF/docx extractors into every caller of this module is waste.
  const { transcribePdfText, extractDocxText } = await import('@/lib/ai/document-text')

  let files: DriveFile[]
  try {
    files = await listFolder(folderId)
  } catch (err) {
    console.error(
      '[drive/import] could not list folder for scoring:',
      err instanceof Error ? err.message : String(err)
    )
    return { text: '', filesRead: 0, fileNames: [] }
  }

  for (const file of files) {
    if (fileNames.length >= maxFiles) break
    if (file.name === MANIFEST_NAME) continue
    if (file.size != null && file.size > maxBytes) continue

    const kind = documentKind(file.mimeType, file.name)
    if (kind === 'unsupported' && !exportable(file)) continue

    try {
      const content = await fetchDriveFile(file)
      if (!content) continue

      let text: string | null = null
      const buffer = Buffer.from(content.buffer)
      const resolved = documentKind(content.mimeType, content.fileName)

      if (resolved === 'pdf') {
        text = await transcribePdfText({
          dataBase64: buffer.toString('base64'),
          byteLength: buffer.byteLength,
          fileName: content.fileName,
          // The same system actor the lead score phase already logs under.
          userId: SYSTEM_USER_ID,
        })
      } else if (resolved === 'docx') {
        text = await extractDocxText(content.buffer)
      } else if (resolved === 'text') {
        text = buffer.toString('utf8')
      }

      if (text?.trim()) {
        chunks.push(`### Document: ${content.fileName}\n\n${text.trim()}`)
        fileNames.push(content.fileName)
      }
    } catch (err) {
      // A file that will not read is a thinner evidence block, never a failed
      // score — the checklist alone is still worth judging.
      console.error(
        `[drive/import] could not read ${file.name} for scoring:`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  return { text: chunks.join('\n\n'), filesRead: fileNames.length, fileNames }
}
