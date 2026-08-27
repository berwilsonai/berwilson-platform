/**
 * Publish a record's documents to Drive.
 *
 * Ber Intelligence is tailnet-only. That is a deliberate security posture and it
 * is not changing — but it means a project's RFP, drawings, and addenda are
 * unreachable for most of the company most of the time. Publishing copies them
 * into a Drive folder shared with the domain, so the documents travel while the
 * platform stays put.
 *
 * One-way and additive by design. Drive is a READING surface: nothing is ever
 * read back from it into the record, and a file deleted in Drive is not deleted
 * here. Two-way sync would make Drive a second source of truth, which is exactly
 * the failure the Sheets export is also written to avoid.
 *
 * Idempotent per document via `drive_published_id`, so re-publishing a project
 * uploads only what has been added since.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  DriveScopeError,
  ensureFolder,
  ensureRootFolder,
  folderUrl,
  uploadToFolder,
} from '@/lib/integrations/google-drive-write'
import { PRIMARY_MAILBOX, googleFetch, isGoogleConfigured } from '@/lib/integrations/google-workspace'

export type DriveRecordKind = 'project' | 'opportunity' | 'steel'

export interface PublishResult {
  folderId: string
  folderUrl: string
  uploaded: number
  alreadyPublished: number
  failed: number
  errors: string[]
}

/** Top-level shelf per record type, so the root does not become a flat dump. */
const SECTION: Record<DriveRecordKind, string> = {
  project: 'Projects',
  opportunity: 'Opportunities',
  steel: 'Steel Deals',
}

interface RecordRef {
  table: 'projects' | 'opportunities' | 'steel_deals'
  docTable: 'documents' | 'opportunity_documents'
  docFilter: string
}

const RECORDS: Record<DriveRecordKind, RecordRef> = {
  project: { table: 'projects', docTable: 'documents', docFilter: 'project_id' },
  opportunity: {
    table: 'opportunities',
    docTable: 'opportunity_documents',
    docFilter: 'opportunity_id',
  },
  steel: { table: 'steel_deals', docTable: 'documents', docFilter: 'steel_deal_id' },
}

/** Does the stored folder still exist? A human can delete it in Drive. */
async function folderStillThere(folderId: string): Promise<boolean> {
  try {
    const data = await googleFetch<{ trashed?: boolean }>(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,trashed&supportsAllDrives=true`,
      PRIMARY_MAILBOX
    )
    return data.trashed !== true
  } catch {
    return false
  }
}

/**
 * Publish every not-yet-published document on one record.
 * Throws only on a problem that makes the whole operation impossible.
 */
export async function publishRecordToDrive(
  kind: DriveRecordKind,
  id: string
): Promise<PublishResult> {
  if (!isGoogleConfigured()) {
    throw new Error('Google Workspace is not configured, so nothing can be published to Drive.')
  }

  const ref = RECORDS[kind]
  const supabase = createAdminClient()

  const { data: record, error: recErr } = await supabase
    .from(ref.table)
    .select('id, name, drive_folder_id')
    .eq('id', id)
    .maybeSingle()
  if (recErr) throw new Error(recErr.message)
  if (!record) throw new Error('Record not found.')

  const row = record as { id: string; name: string | null; drive_folder_id: string | null }

  // Resolve the folder: reuse the stored one when it is still real, otherwise
  // create a fresh one. Created rather than looked up by name — two records may
  // legitimately share a name, and merging their bid packages would be worse
  // than an untidy folder list.
  let folderId = row.drive_folder_id
  if (folderId && !(await folderStillThere(folderId))) folderId = null

  if (!folderId) {
    const root = await ensureRootFolder()
    const section = await ensureFolder(SECTION[kind], root.id)
    const created = await ensureFolder(row.name?.trim() || `Untitled ${kind}`, section.id)
    folderId = created.id
    await supabase
      .from(ref.table)
      .update({ drive_folder_id: folderId, drive_folder_url: folderUrl(folderId) })
      .eq('id', id)
  }

  const { data: docs, error: docErr } = await supabase
    .from(ref.docTable)
    .select('id, file_name, mime_type, storage_path, drive_published_id')
    .eq(ref.docFilter, id)
  if (docErr) throw new Error(docErr.message)

  const result: PublishResult = {
    folderId,
    folderUrl: folderUrl(folderId),
    uploaded: 0,
    alreadyPublished: 0,
    failed: 0,
    errors: [],
  }

  type Doc = {
    id: string
    file_name: string
    mime_type: string | null
    storage_path: string
    drive_published_id: string | null
  }

  for (const doc of (docs ?? []) as Doc[]) {
    if (doc.drive_published_id) {
      result.alreadyPublished++
      continue
    }

    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from('documents')
        .download(doc.storage_path)
      if (dlErr || !blob) throw new Error(dlErr?.message ?? 'file missing from storage')

      const uploaded = await uploadToFolder({
        folderId,
        name: doc.file_name,
        mimeType: doc.mime_type ?? 'application/octet-stream',
        bytes: await blob.arrayBuffer(),
      })

      await supabase
        .from(ref.docTable)
        .update({ drive_published_id: uploaded.id })
        .eq('id', doc.id)
      result.uploaded++
    } catch (err) {
      // A missing scope fails identically for every remaining file, so say it
      // once and stop rather than repeating it per document.
      if (err instanceof DriveScopeError) throw err
      result.failed++
      if (result.errors.length < 5) {
        result.errors.push(`${doc.file_name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  return result
}

/**
 * Publish without ever failing the caller — for the promotion path, where the
 * record and its documents are already safely created and a Drive hiccup must
 * not read as "promotion failed".
 */
export async function publishRecordQuietly(
  kind: DriveRecordKind,
  id: string
): Promise<PublishResult | null> {
  try {
    return await publishRecordToDrive(kind, id)
  } catch (err) {
    console.warn('[drive/publish] skipped:', err instanceof Error ? err.message : err)
    return null
  }
}
