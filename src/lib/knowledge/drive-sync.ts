/**
 * Nightly Drive → company knowledge base sync.
 *
 * Why this exists: assessFit() already asks for a "RELEVANT BER WILSON EVIDENCE"
 * block, retrieved from `is_company` chunks. Without documents behind it, every
 * lead is scored against a paragraph of profile text. Pointing the sync at a
 * folder of capability statements, past performance, and credentials is what
 * turns a generic score into a grounded one.
 *
 * Several folders can be nominated (comma-separated), so the corporate tree is
 * indexed a shelf at a time — Corporate, estimation templates, prefab steel
 * training — rather than by pointing at a drive root and hoovering up drafts.
 * Nominating folders IS the control model.
 *
 * Change detection is by (drive_file_id, drive_modified_at), compared as
 * instants — see driveFileUnchanged, and do not reduce it back to a string
 * comparison: the stored timestamptz round-trips with an offset while Drive
 * sends `Z`, so text equality never holds and every file is re-indexed nightly.
 * An unchanged file costs one list entry and nothing else. An edited one is re-downloaded,
 * re-uploaded, and re-indexed in place, with its old chunks removed first so a
 * revision cannot leave both versions in the index contradicting each other.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { runDocumentAiPass, documentKind, needsAnotherPass } from '@/lib/ai/document-pipeline'
import {
  listFolder,
  fetchDriveFile,
  driveKnowledgeFolderIds,
  driveFileUnchanged,
  type DriveFile,
} from '@/lib/integrations/google-drive'
import { reconcileVanished, restoreDocument, type KnownDriveDoc } from '@/lib/drive/supersede'

/** Nothing bigger — a 100MB video is not knowledge-base material. */
const MAX_FILE_BYTES = 30 * 1024 * 1024

export interface DriveSyncProgress {
  seen: number
  added: number
  updated: number
  unchanged: number
  skipped: number
  failed: number
  /** Retired because they are no longer in any nominated folder. */
  superseded: number
  supersedeHeldBack: string | null
  errors: string[]
  outOfTime: boolean
}

interface KnownDoc extends KnownDriveDoc {
  storage_path: string
  drive_modified_at: string | null
  embedding_status: string | null
}

export async function syncDriveKnowledge(
  opts: { budgetMs?: number; folderId?: string; folderIds?: string[] } = {}
): Promise<DriveSyncProgress> {
  const folderIds =
    opts.folderIds ?? (opts.folderId ? [opts.folderId] : driveKnowledgeFolderIds())
  if (folderIds.length === 0) {
    throw new Error(
      'No knowledge folder configured. Set GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID to a Drive folder id (comma-separated for several).'
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
    superseded: 0,
    supersedeHeldBack: null,
    errors: [],
    outOfTime: false,
  }

  // Nominated folders may nest — "Corporate" holds Board Meetings, Fundraising,
  // M&A — so this walks deeper than the two levels a single curated folder needs.
  // Archive subtrees are skipped inside listFolder.
  const files: DriveFile[] = []
  const seenIds = new Set<string>()
  for (const id of folderIds) {
    // One unreadable folder must not cost the others: a mistyped id in a list of
    // five would otherwise take the whole knowledge base down every night.
    try {
      files.push(...(await listFolder(id, { maxDepth: 4 })))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[drive-sync] could not list folder ${id}:`, message)
      progress.errors.push(`folder ${id}: ${message.slice(0, 160)}`)
      progress.failed++
    }
  }
  progress.seen = files.length

  // Company documents only. A file already imported onto a PROJECT is owned
  // there — `documents.drive_file_id` is uniquely indexed, so claiming it here
  // would either steal the row or fail the insert every night forever.
  const { data: existingRows } = await supabase
    .from('documents')
    .select('id, storage_path, drive_file_id, drive_modified_at, superseded_at, is_company, embedding_status')
    .not('drive_file_id', 'is', null)

  const known = new Map<string, KnownDoc>()
  const ownedElsewhere = new Set<string>()
  for (const row of (existingRows ?? []) as (KnownDoc & { is_company: boolean })[]) {
    if (row.is_company) known.set(row.drive_file_id, row)
    else ownedElsewhere.add(row.drive_file_id)
  }

  for (const file of files) {
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }

    if (ownedElsewhere.has(file.id)) {
      progress.skipped++
      continue
    }
    // The same file reaches this loop twice when it sits in two nominated
    // folders, or in one nested inside another. `known` is a snapshot taken
    // before the loop, so the second copy looks new and its insert violates the
    // unique index on drive_file_id — a hard failure logged on every run.
    if (seenIds.has(file.id)) {
      progress.skipped++
      continue
    }

    seenIds.add(file.id)
    const prior = known.get(file.id)

    // A file back out of the archive is news even though its bytes did not
    // change: its chunks were deleted when it was retired, and only a re-index
    // brings them back.
    const returning = !!prior?.superseded_at
    if (returning && prior) await restoreDocument(supabase, prior.id)

    // A document whose AI pass never finished has a file but no text and no
    // chunks, so it is invisible to the search it was imported for — while
    // change detection correctly reports its bytes as unchanged and never comes
    // back for it. The project sync has always retried these; this one did not,
    // and sixteen company documents sat unreadable indefinitely as a result,
    // including the Tooele Army Depot LOI and two patents.
    const stranded = !!prior && needsAnotherPass(prior.embedding_status)

    // Drive's modifiedTime changes on any edit — same instant means nothing to do.
    if (prior && !returning && !stranded && driveFileUnchanged(prior.drive_modified_at, file)) {
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
        if (error) {
          // 23505 on drive_file_id means another run inserted this file between
          // this one's snapshot of the known documents and now. Two syncs do
          // overlap in practice: a hand-triggered run and the nightly cron, or
          // a client that disconnected without stopping the server handler.
          // Losing the race is not a failure — the document is imported.
          if (error.code === '23505') {
            progress.skipped++
            continue
          }
          throw new Error(error.message)
        }
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

  // Archived or removed in Drive — retired here, never deleted. The guards in
  // reconcileVanished are the important part: a re-permissioned folder returns
  // fewer files than it holds, and obeying that would empty the knowledge base.
  const vanished = await reconcileVanished({
    supabase,
    known: [...known.values()],
    seen: seenIds,
    partial: progress.outOfTime,
    listed: files.length,
    reason: 'No longer in a nominated Drive knowledge folder (archived or removed).',
  })
  progress.superseded = vanished.superseded
  progress.supersedeHeldBack = vanished.heldBack

  return progress
}

/** Google Docs arrive as an unsupported mime but export to text — keep them. */
function EXPORTABLE(file: DriveFile): boolean {
  return file.mimeType === 'application/vnd.google-apps.document'
}
