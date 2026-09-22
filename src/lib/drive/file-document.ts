/**
 * Filing a document into the team's OWN Drive folder, in the right subfolder.
 *
 * The problem: the platform published into `Ber Intelligence` in moose@'s My
 * Drive, while the team files its real work in the `Ber Wilson Proper` shared
 * drive. Two document homes, and the team only ever opened one. An emailed deed
 * reached storage, was copied to a folder nobody looks at, and never landed in
 * the `Deeds` folder sitting one level away.
 *
 * ⚠ THE LOOP GUARD IS THE LOAD-BEARING PART OF THIS FILE.
 *
 * Uploading INTO a record's `drive_source_folder_id` means the nightly importer
 * READS BACK the file we just wrote. import.ts anticipated this in a comment:
 * "the day a project's source folder and its published folder are the same one,
 * every published file would return as a duplicate of itself." Today is that
 * day. Verified against the real skip sets in import.ts:
 *
 *   - `published` is built from `drive_published_id NOT NULL AND drive_file_id
 *     IS NULL`, so stamping only drive_published_id would NOT protect us.
 *   - `known` is built from `drive_file_id NOT NULL`.
 *
 * So a filed document stamps all three -- drive_file_id, drive_modified_at,
 * drive_published_id -- and the importer then finds it in `known`,
 * short-circuits on driveFileUnchanged, and counts it `unchanged`. Removing any
 * one of the three re-opens the duplicate. The timestamp matters as much as the
 * id: driveFileUnchanged(null, file) is false, so a row filed without it is
 * re-downloaded and re-embedded every single night.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isRecordLive } from '@/lib/records/live'
import type { Database } from '@/types/database'
import { ensureFolder, uploadToFolder } from '@/lib/integrations/google-drive-write'
import { listSubfolders } from '@/lib/integrations/google-drive'
import { PRIMARY_MAILBOX, googleFetch, isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { chooseFolder, STANDARD_FOLDERS, UNSORTED_FOLDER, type FolderChoice } from './classify'

type AdminClient = SupabaseClient<Database>

export type FileableKind = 'project' | 'opportunity'

/** Same ceiling the importer applies. Better refused here than as a Google error. */
const MAX_FILE_BYTES = 30 * 1024 * 1024

export interface FilingTarget {
  kind: FileableKind
  id: string
  name: string
  sourceFolderId: string
}

export interface FiledResult {
  documentId: string
  driveFileId: string
  folderName: string
  webViewLink: string | null
  choice: FolderChoice
}

const DOC_TABLE: Record<FileableKind, 'documents' | 'opportunity_documents'> = {
  project: 'documents',
  opportunity: 'opportunity_documents',
}

/**
 * Which shared drive a folder belongs to.
 *
 * listSubfolders needs this to search the right corpus; without it Google
 * searches the user's own corpus and returns nothing, which reads as "this
 * project has no subfolders" and would silently send every document to the
 * standard set. Cached because it never changes for a folder.
 */
const driveIdCache = new Map<string, string | null>()

export async function resolveDriveId(folderId: string): Promise<string | null> {
  if (driveIdCache.has(folderId)) return driveIdCache.get(folderId) ?? null
  try {
    const meta = await googleFetch<{ driveId?: string }>(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=driveId&supportsAllDrives=true`,
      PRIMARY_MAILBOX
    )
    const id = meta.driveId ?? null
    driveIdCache.set(folderId, id)
    return id
  } catch {
    return null
  }
}

/**
 * Things that are not documents and have no business in a filing cabinet.
 *
 * A calendar invite arrives as an email attachment like any other and becomes a
 * `documents` row, but nobody filing a project's paperwork wants four copies of
 * `invite.ics` in it. Narrow on purpose: an extension is only listed when the
 * file is machine chrome rather than content a person would ever open on its
 * own. A .dwg is unreadable to the platform and still absolutely a document.
 */
const NOT_DOCUMENTS = new Set(['.ics', '.vcf', '.ics.txt'])

export function isFileable(fileName: string, mimeType: string | null): boolean {
  const lower = fileName.toLowerCase()
  if ([...NOT_DOCUMENTS].some((ext) => lower.endsWith(ext))) return false
  if ((mimeType ?? '').toLowerCase().startsWith('text/calendar')) return false
  return true
}

/**
 * Did the platform write this document itself?
 *
 * Email-research reports and meeting minutes are generated summaries saved as
 * markdown. They are useful, and they are still not the team's paperwork -- so
 * they are never classified INTO a folder a human curated. Measured on the real
 * corpus: "Email research — Helper.md" was being filed into "Master Proposal -
 * Land Development" at 0.70 confidence, which is a platform artifact landing in
 * a folder someone else maintains. They go to _Unsorted instead, where moving
 * one is a deliberate act by the person who wants it.
 */
export function isStandardSet(candidates: string[]): boolean {
  // Compared by content rather than by "did we just create it": `created` is
  // true only for the very first document filed, so relying on it would file
  // the first generated summary to Correspondence and every later one to
  // _Unsorted. A folder set is the platform's own iff it is exactly ours.
  if (candidates.length !== STANDARD_FOLDERS.length) return false
  const mine = new Set<string>(STANDARD_FOLDERS)
  return candidates.every((c) => mine.has(c))
}

export function isPlatformArtifact(fileName: string, mimeType: string | null): boolean {
  if ((mimeType ?? '').toLowerCase().includes('markdown')) return true
  return /^(email research|meeting) — /i.test(fileName.trim())
}

/** How many container hops to follow. Bounded so a odd tree cannot walk away. */
const MAX_CONTAINER_HOPS = 3

async function countFiles(folderId: string): Promise<number> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: 'files(id)',
    pageSize: '10',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })
  const data = await googleFetch<{ files?: unknown[] }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    PRIMARY_MAILBOX
  )
  return (data.files ?? []).length
}

/**
 * Follow shelf folders down to the one a document actually belongs in.
 *
 * ⚠ Found by running this against the real links, not by reading the schema:
 * folders are linked at the BUSINESS-LINE level, not the project level. DUBHES
 * points at "Helper - Utah", whose single child "PQC Giovanni Campus " is the
 * folder holding Deeds / Land Legal / Previous Land Offers. Filing against the
 * link as given would have offered "PQC Giovanni Campus" as the one candidate
 * and never reached the real taxonomy at all.
 *
 * The rule: a folder holding NO files and EXACTLY ONE subfolder is a shelf, not
 * a filing choice -- there is no decision to make there, so step through it.
 * A folder with files of its own is somewhere people already file, so it stays
 * put however many subfolders it has. Measured against all six linked projects:
 * Helper and Trump City descend correctly, and Stockton (7 loose files plus two
 * subfolders) correctly does not.
 */
export async function resolveFilingRoot(sourceFolderId: string): Promise<string> {
  let current = sourceFolderId
  const driveId = (await resolveDriveId(sourceFolderId)) ?? undefined

  for (let hop = 0; hop < MAX_CONTAINER_HOPS; hop++) {
    const kids = await listSubfolders(current, { driveId, orderBy: 'name' })
    const usable = kids.filter((k) => !isArchiveName(k.name))
    if (usable.length !== 1) return current
    if ((await countFiles(current)) > 0) return current
    current = usable[0].id
  }
  return current
}

/**
 * The folders this record can be filed into.
 *
 * Hybrid by design, and the survey is why: of 15 project folders, exactly one
 * had subfolders, and its names ("Deeds", "Previous Land Offers") reflect how
 * that particular deal is run. So a record that already has folders keeps them
 * untouched and is never given the standard set; only a bare folder gets one.
 */
export async function resolveCandidateFolders(
  folderId: string,
  opts: { createStandard?: boolean } = {}
): Promise<{ candidates: string[]; created: boolean }> {
  const driveId = await resolveDriveId(folderId)
  const existing = await listSubfolders(folderId, {
    driveId: driveId ?? undefined,
    orderBy: 'name',
  })

  // Archive shelves are never a filing destination -- the whole point of that
  // convention is that dragging something in RETIRES it.
  const usable = existing.map((f) => f.name).filter((n) => !isArchiveName(n))

  if (usable.length > 0) return { candidates: usable, created: false }
  if (!opts.createStandard) return { candidates: [], created: false }

  for (const name of STANDARD_FOLDERS) {
    await ensureFolder(name, folderId)
  }
  return { candidates: [...STANDARD_FOLDERS], created: true }
}

/** Mirrors isArchiveFolder in google-drive.ts, which is not exported for names. */
function isArchiveName(name: string): boolean {
  const n = name.trim().toLowerCase()
  return ['archive', 'archived', 'archives', 'old', 'obsolete', 'superseded', 'deprecated', 'do not use'].includes(n)
}

/**
 * File one already-stored document into its record's Drive folder.
 *
 * Returns null rather than throwing when filing is not possible or not wanted:
 * a Drive problem must never fail the attachment import that called this.
 */
export async function fileDocumentToDrive(
  supabase: AdminClient,
  target: FilingTarget,
  doc: {
    id: string
    file_name: string
    storage_path: string
    mime_type: string | null
    file_size_bytes: number | null
    ai_summary: string | null
    drive_file_id: string | null
  },
  opts: { userId?: string } = {}
): Promise<FiledResult | null> {
  if (!isGoogleConfigured()) return null

  // A document that CAME from Drive is already in the team's folder. Re-filing
  // it would make a second copy and fight the unique index on drive_file_id.
  if (doc.drive_file_id) return null
  if ((doc.file_size_bytes ?? 0) > MAX_FILE_BYTES) return null
  if (!isFileable(doc.file_name, doc.mime_type)) return null

  const filingRoot = await resolveFilingRoot(target.sourceFolderId)
  const { candidates } = await resolveCandidateFolders(filingRoot, { createStandard: true })

  // A generated summary is filed, but never into a folder a human curated.
  const choice: FolderChoice =
    isPlatformArtifact(doc.file_name, doc.mime_type) && !isStandardSet(candidates)
    ? {
        folderName: null,
        confidence: 1,
        reason: 'platform-generated summary — kept out of the team\'s own folders',
        deterministic: true,
      }
    : await chooseFolder({
        fileName: doc.file_name,
        mimeType: doc.mime_type,
        aiSummary: doc.ai_summary,
        recordName: target.name,
        candidates,
        userId: opts.userId,
      })

  // An unsure answer goes to _Unsorted, never to a plausible guess. A document
  // misfiled into a folder the team trusts is worse than one waiting to be
  // sorted, because nobody looks for a file they believe is already filed.
  const folderName = choice.folderName ?? UNSORTED_FOLDER
  const folder = await ensureFolder(folderName, filingRoot)

  const { data: blob, error: dlError } = await supabase.storage
    .from('documents')
    .download(doc.storage_path)
  if (dlError || !blob) return null

  const bytes = await blob.arrayBuffer()
  const uploaded = await uploadToFolder({
    folderId: folder.id,
    name: doc.file_name,
    mimeType: doc.mime_type || 'application/octet-stream',
    bytes,
  })

  // All three, for the reason in the header. Removing any one re-opens the
  // duplicate-of-itself import.
  await supabase
    .from(DOC_TABLE[target.kind])
    .update({
      drive_file_id: uploaded.id,
      drive_modified_at: uploaded.modifiedTime ?? new Date().toISOString(),
      drive_published_id: uploaded.id,
      drive_folder_path: folderName,
    })
    .eq('id', doc.id)

  return {
    documentId: doc.id,
    driveFileId: uploaded.id,
    folderName,
    webViewLink: uploaded.webViewLink ?? null,
    choice,
  }
}

export interface FileRecordResult {
  filed: number
  unsorted: number
  failed: number
  skipped: number
  errors: string[]
  outOfTime: boolean
}

const RECORD_TABLE: Record<FileableKind, 'projects' | 'opportunities'> = {
  project: 'projects',
  opportunity: 'opportunities',
}

/**
 * File every unfiled document on one record.
 *
 * Driven by the DOCUMENTS rather than the record, so a record whose files are
 * all filed costs one indexed query and nothing else -- the same shape
 * reconcileDrivePublishing already uses.
 *
 * Returns a zeroed result when the record has no linked source folder. That is
 * a configuration state, not a failure: 9 of 15 projects are unlinked, and
 * reporting them as errors every night would bury the real ones.
 */
export async function fileRecordDocuments(
  supabase: AdminClient,
  kind: FileableKind,
  recordId: string,
  opts: {
    budgetMs?: number
    userId?: string
    /**
     * File even when the record is lost/closed/on hold. Set by
     * publishRecordToDrive, whose callers are either an explicit human click or
     * the nightly reconcile, which does its own filtering — a person pressing
     * "Publish to Drive" on a parked project means it.
     */
    includeDormant?: boolean
  } = {}
): Promise<FileRecordResult> {
  const result: FileRecordResult = {
    filed: 0, unsorted: 0, failed: 0, skipped: 0, errors: [], outOfTime: false,
  }
  if (!isGoogleConfigured()) return result

  const deadline = Date.now() + (opts.budgetMs ?? 10 * 60 * 1000)

  const { data: record } = await supabase
    .from(RECORD_TABLE[kind])
    .select('id, name, status, drive_source_folder_id')
    .eq('id', recordId)
    .maybeSingle()

  const row = record as { drive_source_folder_id?: string | null; status?: string | null } | null
  const sourceFolderId = row?.drive_source_folder_id
  if (!record || !sourceFolderId) return result

  // A dead pursuit stops filing into the team's folder. Status is read here
  // rather than filtered in the query because a NULL status would not match a
  // PostgREST `not.in` — see src/lib/records/live.ts.
  if (!opts.includeDormant && !isRecordLive(kind, { status: row?.status ?? null })) {
    result.skipped += 1
    return result
  }

  // Branched rather than computed: a union table name makes the column filter
  // a union too, which TypeScript cannot check. The repo is at zero `any`
  // escapes and this is not the place to spend the first one.
  const COLUMNS = 'id, file_name, storage_path, mime_type, file_size_bytes, ai_summary, drive_file_id'
  const { data: docs } =
    kind === 'project'
      ? await supabase
          .from('documents')
          .select(COLUMNS)
          .eq('project_id', recordId)
          .is('drive_file_id', null)
          .is('superseded_at', null)
      : await supabase
          .from('opportunity_documents')
          .select(COLUMNS)
          .eq('opportunity_id', recordId)
          .is('drive_file_id', null)
          .is('superseded_at', null)

  const target: FilingTarget = {
    kind,
    id: recordId,
    name: (record as { name?: string | null }).name ?? 'Untitled',
    sourceFolderId,
  }

  for (const doc of (docs ?? []) as Array<Parameters<typeof fileDocumentToDrive>[2]>) {
    if (Date.now() >= deadline) {
      result.outOfTime = true
      break
    }
    try {
      const filed = await fileDocumentToDrive(supabase, target, doc, { userId: opts.userId })
      if (!filed) {
        result.skipped++
        continue
      }
      result.filed++
      if (filed.folderName === UNSORTED_FOLDER) result.unsorted++
    } catch (err) {
      result.failed++
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`${doc.file_name}: ${message}`)
    }
  }

  return result
}

/** Never throws -- for call sites where filing is a nicety, not the job. */
export async function fileRecordDocumentsQuietly(
  supabase: AdminClient,
  kind: FileableKind,
  recordId: string,
  opts: { budgetMs?: number; userId?: string } = {}
): Promise<FileRecordResult | null> {
  try {
    return await fileRecordDocuments(supabase, kind, recordId, opts)
  } catch {
    return null
  }
}
