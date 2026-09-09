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
import { reconcileVanished, restoreDocument, type KnownDriveDoc } from './supersede'
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
  /** Documents retired because they are no longer in the folder. */
  superseded: number
  /** Set when the vanish guard refused to retire anything, with the reason. */
  supersedeHeldBack: string | null
  errors: string[]
  outOfTime: boolean
  /** What actually arrived, for the update posted to the project's feed. */
  arrivals: DocumentArrival[]
}

export interface DocumentArrival {
  fileName: string
  /** Subfolder it came from, blank when it sat at the top of the folder. */
  path: string
  kind: 'added' | 'revised'
  summary: string | null
}

interface KnownDoc extends KnownDriveDoc {
  drive_modified_at: string | null
  embedding_status: string | null
}

/**
 * A document whose AI pass never finished is worth another try even though its
 * bytes have not changed. This repo has stranded documents at 'processing' twice
 * before — an app restart mid-pass leaves a row that has a file, no text and no
 * chunks, and is therefore invisible to the search it was imported for. Nothing
 * ever comes back for it, because change detection correctly says "unchanged".
 */
function needsAnotherPass(status: string | null): boolean {
  return status !== 'complete' && status !== 'skipped'
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
  /** Subfolder depth to walk. */
  maxDepth?: number
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
    superseded: 0,
    supersedeHeldBack: null,
    errors: [],
    outOfTime: false,
    arrivals: [],
  }

  // Deeper than the knowledge default: a team's own project folder nests by
  // phase and discipline ("Trump City / West Wendover", "Stockton / LOI"), and
  // stopping at two levels would silently miss most of it. Archive subtrees are
  // skipped inside listFolder — that is the retirement gesture.
  const files = await listFolder(folderId, { maxDepth: opts.maxDepth ?? 4 })
  result.seen = files.length

  // Scoped to this project. `documents.drive_file_id` is uniquely indexed, so a
  // file can only belong to one record anyway; scoping keeps a file owned by
  // another project from being silently rewritten to point at this one.
  const { data: existingRows } = await supabase
    .from('documents')
    .select('id, drive_file_id, drive_modified_at, superseded_at, embedding_status')
    .eq('project_id', projectId)
    .not('drive_file_id', 'is', null)

  const known = new Map<string, KnownDoc>()
  for (const row of (existingRows ?? []) as KnownDoc[]) {
    known.set(row.drive_file_id, row)
  }

  // `documents.drive_file_id` is UNIQUELY indexed platform-wide, so a file
  // already imported somewhere else cannot be inserted here. Looked up rather
  // than discovered by failing: the same document genuinely does appear in two
  // teams' folders, and letting the insert violate the constraint turns a
  // routine overlap into a hard failure logged every single night.
  const { data: elsewhereRows } = await supabase
    .from('documents')
    .select('drive_file_id')
    .not('drive_file_id', 'is', null)
    .or(`project_id.neq.${projectId},project_id.is.null`)
  const ownedElsewhere = new Set(
    ((elsewhereRows ?? []) as { drive_file_id: string }[]).map((r) => r.drive_file_id)
  )

  // Files this platform PUT in Drive must never be read back in as new
  // documents. It cannot happen while publishing targets its own folder, but the
  // day a project's source folder and its published folder are the same one,
  // every published file would return as a duplicate of itself.
  //
  // The `drive_file_id is null` filter is load-bearing and was found by running
  // this: an IMPORTED document is deliberately stamped drive_published_id = its
  // own Drive id, so without it every file already imported was skipped as
  // "something we published", which defeated change detection and then made the
  // whole folder look like it had vanished.
  const { data: publishedRows } = await supabase
    .from('documents')
    .select('drive_published_id')
    .eq('project_id', projectId)
    .not('drive_published_id', 'is', null)
    .is('drive_file_id', null)
  const published = new Set(
    ((publishedRows ?? []) as { drive_published_id: string }[]).map((r) => r.drive_published_id)
  )

  const seenIds = new Set<string>()

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
    if (published.has(file.id)) {
      result.skipped++
      continue
    }
    if (!known.has(file.id) && ownedElsewhere.has(file.id)) {
      result.skipped++
      continue
    }
    // A file reachable by two paths inside one folder tree arrives twice; the
    // second copy is not in `known` (a pre-loop snapshot) and its insert would
    // violate the unique index on drive_file_id.
    if (seenIds.has(file.id)) {
      result.skipped++
      continue
    }

    seenIds.add(file.id)
    const prior = known.get(file.id)

    // A file back out of the archive is news even though its bytes did not
    // change, so the unchanged short-circuit must not swallow it: its chunks
    // were deleted when it was retired and only a re-index brings them back.
    const returning = !!prior?.superseded_at
    if (returning && prior) await restoreDocument(supabase, prior.id)

    const stranded = !!prior && needsAnotherPass(prior.embedding_status)

    // Drive's modifiedTime changes on any edit — same instant means nothing to do.
    if (prior && !returning && !stranded && driveFileUnchanged(prior.drive_modified_at, file)) {
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
      const pass = await runDocumentAiPass({
        supabase,
        documentId,
        projectId,
        fileName: content.fileName,
        mimeType: content.mimeType,
        buffer: content.buffer,
      })

      // A retry of an unfinished pass is not news — the document was already
      // announced when it first arrived, and re-announcing it every time an
      // index failed would fill the feed with the same file.
      const retryOnly = stranded && !returning && driveFileUnchanged(prior?.drive_modified_at ?? null, file)
      if (!retryOnly) {
        result.arrivals.push({
          fileName: content.fileName,
          path: file.path ?? '',
          kind: prior ? 'revised' : 'added',
          summary: pass.aiSummary,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[drive/import] ${file.name} failed:`, message)
      result.errors.push(`${file.name}: ${message.slice(0, 200)}`)
      result.failed++
    }
  }

  // Anything imported before that is no longer in the folder was archived or
  // removed in Drive. Retired here, never deleted — see supersede.ts for why the
  // guards around this are the important part.
  const vanished = await reconcileVanished({
    supabase,
    known: [...known.values()],
    seen: seenIds,
    partial: result.outOfTime,
    listed: files.length,
    reason: 'No longer in the linked Drive folder (archived or removed).',
  })
  result.superseded = vanished.superseded
  result.supersedeHeldBack = vanished.heldBack

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
