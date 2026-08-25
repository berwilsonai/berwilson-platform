/**
 * Nightly Drive → company knowledge base sync.
 *
 * Why this exists: assessFit() already asks for a "RELEVANT BER WILSON EVIDENCE"
 * block, retrieved from `is_company` chunks. Without documents behind it, every
 * lead is scored against a paragraph of profile text. Pointing the sync at a
 * folder of capability statements, past performance, and credentials is what
 * turns a generic score into a grounded one.
 *
 * Change detection is by (drive_file_id, drive_modified_at): an unchanged file
 * costs one list entry and nothing else. An edited one is re-downloaded,
 * re-uploaded, and re-indexed in place, with its old chunks removed first so a
 * revision cannot leave both versions in the index contradicting each other.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { runDocumentAiPass, documentKind } from '@/lib/ai/document-pipeline'
import {
  listFolder,
  fetchDriveFile,
  driveKnowledgeFolderId,
  type DriveFile,
} from '@/lib/integrations/google-drive'

/** Nothing bigger — a 100MB video is not knowledge-base material. */
const MAX_FILE_BYTES = 30 * 1024 * 1024

export interface DriveSyncProgress {
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
  storage_path: string
  drive_modified_at: string | null
}

export async function syncDriveKnowledge(
  opts: { budgetMs?: number; folderId?: string } = {}
): Promise<DriveSyncProgress> {
  const folderId = opts.folderId ?? driveKnowledgeFolderId()
  if (!folderId) {
    throw new Error(
      'No knowledge folder configured. Set GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID to a Drive folder id.'
    )
  }

  const budgetMs = opts.budgetMs ?? 20 * 60 * 1000
  const deadline = Date.now() + budgetMs
  const supabase = createAdminClient()

  const progress: DriveSyncProgress = {
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
  progress.seen = files.length

  const { data: existingRows } = await supabase
    .from('documents')
    .select('id, storage_path, drive_file_id, drive_modified_at')
    .not('drive_file_id', 'is', null)

  const known = new Map<string, KnownDoc>()
  for (const row of (existingRows ?? []) as (KnownDoc & { drive_file_id: string })[]) {
    known.set(row.drive_file_id, row)
  }

  for (const file of files) {
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }

    const prior = known.get(file.id)
    // Drive's modifiedTime changes on any edit — equality means nothing to do.
    if (prior && prior.drive_modified_at === file.modifiedTime) {
      progress.unchanged++
      continue
    }

    if (file.size != null && file.size > MAX_FILE_BYTES) {
      progress.skipped++
      continue
    }
    if (documentKind(file.mimeType, file.name) === 'unsupported' && !EXPORTABLE(file)) {
      progress.skipped++
      continue
    }

    try {
      const content = await fetchDriveFile(file)
      if (!content) {
        progress.skipped++
        continue
      }

      const path = `company/drive/${file.id}-${content.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
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
        progress.updated++
      } else {
        const { data, error } = await supabase
          .from('documents')
          .insert({
            storage_path: path,
            file_name: content.fileName,
            mime_type: content.mimeType,
            file_size_bytes: file.size,
            is_company: true,
            doc_type: 'capability',
            drive_file_id: file.id,
            drive_modified_at: file.modifiedTime,
          })
          .select('id')
          .single()
        if (error) throw new Error(error.message)
        documentId = data.id
        progress.added++
      }

      // Settles embedding_status itself and never throws.
      await runDocumentAiPass({
        supabase,
        documentId,
        projectId: null,
        isCompany: true,
        fileName: content.fileName,
        mimeType: content.mimeType,
        buffer: content.buffer,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[drive-sync] ${file.name} failed:`, message)
      progress.errors.push(`${file.name}: ${message.slice(0, 200)}`)
      progress.failed++
    }
  }

  return progress
}

/** Google Docs arrive as an unsupported mime but export to text — keep them. */
function EXPORTABLE(file: DriveFile): boolean {
  return file.mimeType === 'application/vnd.google-apps.document'
}
