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
  getFolderName,
  type DriveFile,
} from '@/lib/integrations/google-drive'
import {
  reconcileVanished,
  restoreDocument,
  supersedeDocument,
  type KnownDriveDoc,
} from '@/lib/drive/supersede'
import { hashDocumentBytes, loadScopeHashes, findDuplicate } from '@/lib/documents/dedupe'
import type { DocumentArrival } from '@/lib/drive/import'

/** Nothing bigger — a 100MB video is not knowledge-base material. */
const MAX_FILE_BYTES = 30 * 1024 * 1024

export interface DriveSyncProgress {
  seen: number
  added: number
  updated: number
  unchanged: number
  skipped: number
  /**
   * WHY each skipped file was skipped, counted by reason.
   *
   * `skipped` alone is six different outcomes in one number, and it sat at 26
   * every night for weeks while two investor decks and three building-code
   * manuals were silently absent from the knowledge base. A count whose failure
   * mode is doing nothing has to say what it did nothing about.
   */
  skippedReasons: Record<string, number>
  failed: number
  /** Retired because they are no longer in any nominated folder. */
  superseded: number
  supersedeHeldBack: string | null
  /** Imported, then retired immediately as a duplicate of something already here. */
  duplicates: number
  errors: string[]
  outOfTime: boolean
  /** What actually arrived, so the team can be told who added it. */
  arrivals: DocumentArrival[]
}

interface KnownDoc extends KnownDriveDoc {
  storage_path: string
  drive_modified_at: string | null
  embedding_status: string | null
  excluded_at: string | null
  /** A retirement the sync may not undo — see the `retired` set below. */
  superseded_by_hand: boolean | null
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
    skippedReasons: {},
    failed: 0,
    superseded: 0,
    supersedeHeldBack: null,
    duplicates: 0,
    errors: [],
    outOfTime: false,
    arrivals: [],
  }

  const skip = (reason: string) => {
    progress.skipped++
    progress.skippedReasons[reason] = (progress.skippedReasons[reason] ?? 0) + 1
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
      // `listFolder` paths are relative to the folder it was handed, so a file
      // sitting directly in a nominated folder comes back with an empty path.
      // Prefixing the folder's own name is what makes the recorded path say
      // WHICH shelf a document came off — the question the whole company
      // knowledge list could not answer.
      const shelf = (await getFolderName(id)) ?? id
      for (const f of await listFolder(id, { maxDepth: 4 })) {
        files.push({ ...f, path: [shelf, f.path].filter(Boolean).join('/') })
      }
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
  const { data: existingRows, error: existingErr } = await supabase
    .from('documents')
    .select(
      'id, storage_path, drive_file_id, drive_modified_at, superseded_at, is_company, embedding_status, excluded_at, superseded_by_hand'
    )
    .not('drive_file_id', 'is', null)
  if (existingErr) {
    // Without this snapshot every file looks new, and the whole knowledge base
    // is re-inserted (or fails the unique index) on one bad query. Refuse.
    throw new Error(`could not read existing documents: ${existingErr.message}`)
  }

  // An opportunity's Drive files live in a DIFFERENT TABLE, which this check
  // never consulted — so a file already filed on an opportunity was invisible
  // here and got claimed as company knowledge too, giving one file two rows and
  // two sets of chunks. Latent until documents started being filed to
  // opportunities by hand, which is exactly what refileDocument now does.
  const { data: oppRows, error: oppErr } = await supabase
    .from('opportunity_documents')
    .select('drive_file_id')
    .not('drive_file_id', 'is', null)
  if (oppErr) throw new Error(`could not read opportunity documents: ${oppErr.message}`)

  const known = new Map<string, KnownDoc>()
  const ownedElsewhere = new Set<string>()
  /**
   * Files a human has said are not knowledge. Held APART from `known` so
   * reconcileVanished never reconsiders them, and checked before anything else
   * in the loop — after the restore branch the check would do nothing, because
   * `returning` would already have un-retired the row.
   */
  const excluded = new Set<string>()
  /**
   * Retired BY A PERSON — by hand on the Documents tab, or by the deduper on
   * their behalf. Held apart from `known` for the same reason `excluded` is: the
   * `returning` branch below restores any superseded row whose file is still in
   * its folder, so without this the retirement is reversed on the next nightly
   * run. Measured 2026-10-09: that is why no Drive-sourced document had ever
   * been durably retired, and why dedupe-documents.mts refused to act on 48 of
   * the 53 duplicate groups it found.
   *
   * The vanish path deliberately does NOT land here — a file dragged back out of
   * an Archive folder should return, and that supersession carries no lock.
   */
  const retired = new Set<string>()
  for (const row of (existingRows ?? []) as (KnownDoc & { is_company: boolean })[]) {
    if (row.excluded_at) excluded.add(row.drive_file_id)
    else if (row.superseded_by_hand) retired.add(row.drive_file_id)
    else if (row.is_company) known.set(row.drive_file_id, row)
    else ownedElsewhere.add(row.drive_file_id)
  }
  for (const row of (oppRows ?? []) as { drive_file_id: string }[]) {
    ownedElsewhere.add(row.drive_file_id)
  }

  // What the company shelf already holds, by content hash. Read once: the whole
  // point is to catch the same bytes arriving under a SECOND drive_file_id,
  // which `known` (keyed on that id) structurally cannot see.
  const hashes = await loadScopeHashes(supabase, { kind: 'company' })

  for (const file of files) {
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }

    // A human said this is not knowledge. The row is kept as a tombstone, so
    // its drive_file_id still blocks a re-insert; this skip is what stops the
    // sync re-indexing and re-announcing it every night regardless.
    if (excluded.has(file.id)) {
      skip('excluded by hand')
      continue
    }

    // Retired by a person. Checked here, before the restore branch, or
    // `returning` would un-retire it first and the check would do nothing —
    // exactly the ordering bug the exclusion check was written to avoid.
    if (retired.has(file.id)) {
      skip('retired by hand')
      continue
    }

    if (ownedElsewhere.has(file.id)) {
      skip('already imported on a record')
      continue
    }
    // The same file reaches this loop twice when it sits in two nominated
    // folders, or in one nested inside another. `known` is a snapshot taken
    // before the loop, so the second copy looks new and its insert violates the
    // unique index on drive_file_id — a hard failure logged on every run.
    if (seenIds.has(file.id)) {
      skip('listed in two nominated folders')
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
      skip(`over ${MAX_FILE_BYTES / 1024 / 1024}MB`)
      continue
    }
    // A site photo and a logo SVG are not capability evidence. They were being
    // imported, listed among the company documents, and (when OCR read one)
    // embedded into the corpus that grounds every fit assessment — one badge
    // usage sheet alone was 54 chunks. Photos belong on a project or in `media`.
    if (documentKind(file.mimeType, file.name) === 'image') {
      skip('image — not knowledge-base material')
      continue
    }
    if (documentKind(file.mimeType, file.name) === 'unsupported' && !EXPORTABLE(file)) {
      skip(`unreadable type: ${file.mimeType ?? 'unknown'}`)
      continue
    }

    try {
      const content = await fetchDriveFile(file)
      if (!content) {
        skip('Drive returned no content')
        continue
      }

      // The bytes decide. A name is not evidence of sameness and neither is
      // size — four parcels' title commitments are all called "Title Commitment
      // - AS.pdf" within 1.1% of each other.
      const digest = hashDocumentBytes(content.buffer)
      const duplicate = findDuplicate(hashes, digest, prior?.id)

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
            drive_folder_path: file.path ?? null,
            drive_modified_at: file.modifiedTime,
            embedding_status: 'pending',
            extracted_text: null,
            ai_summary: null,
            content_sha256: digest,
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
            // WHICH nominated folder this came from. Already in hand (it is
            // passed to `arrivals` below) and was simply dropped from the row,
            // so the company list had no origin to show or group by while the
            // project importer recorded it all along. It is the evidence for
            // deciding which folders should stay nominated at all.
            drive_folder_path: file.path ?? null,
            drive_modified_at: file.modifiedTime,
            // Written by EVERY door now. A key one importer fills and another
            // leaves NULL is not a shared key: the attachment importer's hash
            // check could not see a single Drive-imported document, so it
            // collided on the name and renamed instead.
            content_sha256: digest,
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
            skip('imported by a concurrent run')
            continue
          }
          throw new Error(error.message)
        }
        documentId = data.id
        progress.added++
      }

      // The same bytes are already on this shelf under a DIFFERENT Drive id —
      // the GridEdge MNDA filed under both "Signed MNDA's" and "NDA NC". The row
      // is kept, because its drive_file_id is what stops the file being imported
      // again tomorrow, but it is retired at once so it never reaches the index
      // and never competes with the copy that was kept. Catching this at the door
      // costs one hash; catching it later costs a cleanup script and a month of
      // split retrieval.
      if (duplicate) {
        await supersedeDocument(
          supabase,
          documentId,
          `Duplicate of ${duplicate.fileName ?? 'a document'} already on the company shelf.`,
          { duplicateOf: duplicate.id }
        )
        // It was inserted, but it was never ADDED to the knowledge base. A count
        // that says otherwise is the kind of number nobody can act on.
        if (!prior) progress.added--
        progress.duplicates++
        progress.skippedReasons['duplicate of a document already here'] =
          (progress.skippedReasons['duplicate of a document already here'] ?? 0) + 1
        continue
      }
      // So that two copies arriving in the SAME run are caught against each
      // other, not just against what was already stored.
      hashes.set(digest, { id: documentId, fileName: content.fileName, superseded: false })

      // Settles embedding_status itself and never throws.
      const pass = await runDocumentAiPass({
        supabase,
        documentId,
        projectId: null,
        isCompany: true,
        fileName: content.fileName,
        mimeType: content.mimeType,
        buffer: content.buffer,
      })

      // A retry of an unfinished pass is not news — the document was announced
      // when it first arrived, and re-announcing it every time an index failed
      // would put the same file in front of people night after night.
      const retryOnly =
        stranded && !returning && driveFileUnchanged(prior?.drive_modified_at ?? null, file)
      if (!retryOnly) {
        progress.arrivals.push({
          fileName: content.fileName,
          path: file.path ?? '',
          kind: prior ? 'revised' : 'added',
          summary: pass.aiSummary,
          documentId,
          webViewLink: file.webViewLink ?? null,
          actorName: file.modifiedByName ?? null,
          actorEmail: file.modifiedByEmail ?? null,
        })
      }
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
