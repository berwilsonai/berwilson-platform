/**
 * Google Drive — read-only access to one nominated knowledge folder.
 *
 * Deliberately narrow. This exists so capability statements, past-performance
 * write-ups, and credential PDFs can be dropped in a Drive folder and become
 * evidence the fit assessor cites, without anyone uploading them twice. "Drop it
 * in the folder to publish it to the AI" is the whole control model — which is
 * why it is ONE folder rather than a shared drive: drafts and internal financials
 * should not be able to wander into lead scoring.
 *
 * Plain fetch, no SDK, reusing the auth in google-workspace.ts (§11: no vendor
 * client libraries in the runtime path).
 */

import {
  PRIMARY_MAILBOX,
  googleFetch,
  googleFetchBytes,
} from './google-workspace'

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3'

/** Google-native types have no bytes to download — they must be exported. */
const GOOGLE_DOC = 'application/vnd.google-apps.document'
const GOOGLE_FOLDER = 'application/vnd.google-apps.folder'

/**
 * Export formats for Google-native files.
 *
 * Docs export as plain text: the AI pass only ever reads their text, and PDF
 * export would mean a needless transcription pass on the way back out.
 * Sheets and Slides are deliberately absent — a spreadsheet flattened to text is
 * misleading evidence, so they are skipped rather than badly indexed.
 */
const EXPORT_AS: Record<string, { mimeType: string; extension: string }> = {
  [GOOGLE_DOC]: { mimeType: 'text/plain', extension: '.txt' },
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  size: number | null
  /**
   * Subfolder path below the folder that was listed, e.g. "Signed NDA" or
   * "Stockton LOI/2026". Empty for a file sitting directly in it. Carried so an
   * import can say WHERE a document came from — in a tree organised by phase,
   * the folder name is half of what the document is.
   */
  path?: string
}

interface DriveListResponse {
  files?: Array<{
    id: string
    name: string
    mimeType: string
    modifiedTime: string
    size?: string
  }>
  nextPageToken?: string
}

export function driveKnowledgeFolderId(): string | null {
  return process.env.GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID?.trim() || null
}

/**
 * Parent folder the website form creates one subfolder per deal inside.
 * Unset means deal intake is switched off, not broken.
 */
export function dealIntakeFolderId(): string | null {
  return process.env.GOOGLE_DEAL_INTAKE_FOLDER_ID?.trim() || null
}

/**
 * Every nominated knowledge folder, as a list.
 *
 * GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID accepts comma-separated ids so the corporate
 * tree can be indexed a shelf at a time — "Corporate", "Estimation Templates",
 * "Prefab Steel" — rather than by pointing at the drive root and hoovering up
 * everything including drafts. Nominating folders IS the control model; keep it.
 */
export function driveKnowledgeFolderIds(): string[] {
  return (process.env.GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function isDriveConfigured(): boolean {
  return driveKnowledgeFolderIds().length > 0
}

/**
 * Folder names that mean "this is retired — do not index it".
 *
 * The retirement gesture for someone with no platform login has to be something
 * they can do in Drive, and dragging a file into an "Archive" folder is the one
 * every team already knows. Matched case-insensitively on the whole folder name
 * only: a project folder legitimately called "Old Mill Road" must not vanish.
 */
const ARCHIVE_FOLDER_NAMES = new Set([
  'archive',
  'archived',
  'archives',
  'old',
  'obsolete',
  'superseded',
  'deprecated',
  'do not use',
])

export function isArchiveFolder(name: string): boolean {
  return ARCHIVE_FOLDER_NAMES.has(name.trim().toLowerCase())
}

/** The archive folder names, for UI copy that has to tell people the convention. */
export const ARCHIVE_FOLDER_LABEL = 'Archive'

/**
 * List every file in a folder, recursing into subfolders.
 *
 * Subtrees whose folder name reads as an archive are skipped entirely — that is
 * how a document is retired by someone who cannot reach the platform.
 *
 * @param maxDepth Subfolder depth. Bounded so a mis-pointed id cannot walk an
 *                 entire Drive. Two is right for a curated knowledge folder;
 *                 a team's own project folder nests deeper and passes more.
 * @param includeArchived Import paths must NOT set this. It exists for the one
 *                 caller that needs to know what was archived rather than
 *                 pretend it never existed.
 */
export async function listFolder(
  folderId: string,
  opts: { mailbox?: string; maxDepth?: number; includeArchived?: boolean } = {}
): Promise<DriveFile[]> {
  const mailbox = opts.mailbox ?? PRIMARY_MAILBOX
  const maxDepth = opts.maxDepth ?? 2
  const out: DriveFile[] = []

  async function walk(id: string, depth: number, path: string[] = []): Promise<void> {
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        q: `'${id}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
        pageSize: '200',
        // Shared drives are not the target, but a folder shared INTO the account
        // still needs these to be listable at all.
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      })
      if (pageToken) params.set('pageToken', pageToken)

      const data = await googleFetch<DriveListResponse>(
        `${DRIVE_BASE}/files?${params.toString()}`,
        mailbox
      )

      for (const f of data.files ?? []) {
        if (f.mimeType === GOOGLE_FOLDER) {
          if (!opts.includeArchived && isArchiveFolder(f.name)) continue
          if (depth < maxDepth) await walk(f.id, depth + 1, [...path, f.name])
          continue
        }
        out.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
          size: f.size ? Number(f.size) : null,
          path: path.join('/'),
        })
      }
      pageToken = data.nextPageToken
    } while (pageToken)
  }

  await walk(folderId, 1)
  return out
}

/**
 * List the immediate subfolders of a folder.
 *
 * {@link listFolder} deliberately DROPS folders — it returns the files inside a
 * tree — so it cannot be used to enumerate one-folder-per-deal intake. This is
 * the complement: folders only, one level, no recursion.
 */
export async function listSubfolders(
  parentId: string,
  opts: { mailbox?: string; driveId?: string; orderBy?: string } = {}
): Promise<DriveFile[]> {
  const mailbox = opts.mailbox ?? PRIMARY_MAILBOX
  const out: DriveFile[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      q: `'${parentId}' in parents and mimeType = '${GOOGLE_FOLDER}' and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
      pageSize: '200',
      orderBy: opts.orderBy ?? 'createdTime desc',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })
    // Listing inside a shared drive needs the drive named explicitly; without it
    // Google searches the user's own corpus and returns nothing, which reads as
    // "the folder is empty" rather than "you asked the wrong corpus".
    if (opts.driveId) {
      params.set('corpora', 'drive')
      params.set('driveId', opts.driveId)
    }
    if (pageToken) params.set('pageToken', pageToken)

    const data = await googleFetch<DriveListResponse>(
      `${DRIVE_BASE}/files?${params.toString()}`,
      mailbox
    )
    for (const f of data.files ?? []) {
      out.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        size: null,
      })
    }
    pageToken = data.nextPageToken
  } while (pageToken)

  return out
}

export interface SharedDrive {
  id: string
  name: string
}

/**
 * Every shared drive the mailbox can see.
 *
 * The team's real document home turned out to be a shared drive, not anybody's
 * My Drive — so a folder picker that only offers My Drive shows an empty shelf
 * and teaches the user the feature is broken.
 */
export async function listSharedDrives(mailbox: string = PRIMARY_MAILBOX): Promise<SharedDrive[]> {
  const data = await googleFetch<{ drives?: SharedDrive[] }>(
    `${DRIVE_BASE}/drives?pageSize=100&fields=drives(id,name)`,
    mailbox
  )
  return (data.drives ?? []).map((d) => ({ id: d.id, name: d.name }))
}

/**
 * How many indexable files sit under a folder, and when the newest changed.
 *
 * Shown next to each folder in the picker: "3 files, newest 9 Sept" is what
 * tells someone they are about to link the right folder, and an empty shelf is
 * usually a sign they should go one level deeper.
 */
export async function summarizeFolder(
  folderId: string,
  opts: { mailbox?: string; maxDepth?: number } = {}
): Promise<{ files: number; newest: string | null }> {
  try {
    const files = await listFolder(folderId, {
      mailbox: opts.mailbox,
      maxDepth: opts.maxDepth ?? 3,
    })
    const newest = files.map((f) => f.modifiedTime).sort().pop() ?? null
    return { files: files.length, newest }
  } catch {
    // A folder that will not list is a blank count in a picker, never an error
    // page over the whole dialog.
    return { files: 0, newest: null }
  }
}

/**
 * Has a Drive file changed since it was last imported?
 *
 * Compared as instants, NOT as strings. Drive returns RFC 3339 with a `Z`
 * ("…38.096Z"); the value is stored in a `timestamptz` column and comes back
 * from PostgREST with an offset ("…38.096+00:00"). The two describe the same
 * moment and never compare equal as text — which silently defeated change
 * detection entirely: every file was re-downloaded, re-summarized (a model call
 * each) and re-embedded on every run, and `unchanged` was never once non-zero.
 *
 * An unparseable stored value counts as changed, which re-imports one file
 * rather than skipping it forever.
 */
export function driveFileUnchanged(
  storedModifiedAt: string | null,
  file: Pick<DriveFile, 'modifiedTime'>
): boolean {
  if (!storedModifiedAt) return false
  const stored = new Date(storedModifiedAt).getTime()
  const current = new Date(file.modifiedTime).getTime()
  return Number.isFinite(stored) && Number.isFinite(current) && stored === current
}

export interface DriveContent {
  buffer: ArrayBuffer
  /** The mime type of what was actually returned — an export changes it. */
  mimeType: string
  /** The file name, with an extension added when it was exported. */
  fileName: string
}

/**
 * Fetch one file's bytes, exporting Google-native formats on the way.
 * Returns null for types that cannot usefully be indexed.
 */
export async function fetchDriveFile(
  file: DriveFile,
  opts: { mailbox?: string } = {}
): Promise<DriveContent | null> {
  const mailbox = opts.mailbox ?? PRIMARY_MAILBOX

  const exportAs = EXPORT_AS[file.mimeType]
  if (exportAs) {
    const buffer = await googleFetchBytes(
      `${DRIVE_BASE}/files/${file.id}/export?mimeType=${encodeURIComponent(exportAs.mimeType)}`,
      mailbox
    )
    return {
      buffer,
      mimeType: exportAs.mimeType,
      fileName: file.name.endsWith(exportAs.extension)
        ? file.name
        : `${file.name}${exportAs.extension}`,
    }
  }

  // Any other Google-native type (Sheets, Slides, Forms, Drawings) — skip.
  if (file.mimeType.startsWith('application/vnd.google-apps')) return null

  const buffer = await googleFetchBytes(
    `${DRIVE_BASE}/files/${file.id}?alt=media&supportsAllDrives=true`,
    mailbox
  )
  return { buffer, mimeType: file.mimeType, fileName: file.name }
}

// ---------------------------------------------------------------------------
// Google Meet artifacts
// ---------------------------------------------------------------------------

/**
 * Where Google Meet drops recordings and transcripts: a "Meet Recordings" folder
 * in the ORGANIZER's My Drive. There is no API to ask for it by role, and the
 * name is locale-dependent, so it is resolved by name with an env override for
 * the case where a Workspace has been configured to file them elsewhere.
 */
const MEET_FOLDER_NAME = 'Meet Recordings'

/** Meet names its transcript docs "<title> - <timestamp> - Transcript". */
const TRANSCRIPT_MARKER = 'Transcript'

export interface MeetArtifacts {
  /** Google Docs holding the verbatim transcript of a call. */
  transcripts: DriveFile[]
  /**
   * Recordings with no sibling transcript. Counted, never imported: a .mp4 is
   * hundreds of megabytes and Whisper already exists for uploads. Surfacing the
   * number is what stops "Meet transcription is switched off in the admin
   * console" from looking identical to "nobody had any meetings".
   */
  recordingsWithoutTranscript: number
  /** True when no Meet Recordings folder exists in this Drive at all. */
  noMeetFolder: boolean
}

/** Explicit folder id override, for Workspaces that file Meet output elsewhere. */
export function meetFolderIdOverride(): string | null {
  return process.env.GOOGLE_MEET_FOLDER_ID?.trim() || null
}

/** Resolve the "Meet Recordings" folder id in a mailbox's Drive, if it exists. */
async function findMeetFolder(mailbox: string): Promise<string | null> {
  const override = meetFolderIdOverride()
  if (override) return override

  const params = new URLSearchParams({
    q: `mimeType = '${GOOGLE_FOLDER}' and name = '${MEET_FOLDER_NAME}' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: '5',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })
  const data = await googleFetch<DriveListResponse>(
    `${DRIVE_BASE}/files?${params.toString()}`,
    mailbox
  )
  return data.files?.[0]?.id ?? null
}

/**
 * List the Meet transcripts in one mailbox's Drive, newest first.
 *
 * Deliberately scoped to the Meet Recordings folder rather than searching the
 * whole Drive for documents named "…Transcript" — an executive's own notes file
 * called "Interview Transcript" is not a meeting recording, and importing it
 * would put a stranger's words in front of the review queue.
 *
 * @param since Only files modified after this ISO timestamp. Bounds a first run
 *              so a Drive with years of calls doesn't stage hundreds of sessions.
 */
export async function listMeetTranscripts(
  mailbox: string,
  opts: { since?: string; limit?: number } = {}
): Promise<MeetArtifacts> {
  const folderId = await findMeetFolder(mailbox)
  if (!folderId) {
    return { transcripts: [], recordingsWithoutTranscript: 0, noMeetFolder: true }
  }

  const clauses = [`'${folderId}' in parents`, 'trashed = false']
  if (opts.since) clauses.push(`modifiedTime > '${opts.since}'`)

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
    pageSize: '200',
    orderBy: 'modifiedTime desc',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })

  const transcripts: DriveFile[] = []
  const recordings: DriveFile[] = []
  let pageToken: string | undefined

  do {
    if (pageToken) params.set('pageToken', pageToken)
    const data = await googleFetch<DriveListResponse>(
      `${DRIVE_BASE}/files?${params.toString()}`,
      mailbox
    )
    for (const f of data.files ?? []) {
      const file: DriveFile = {
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        size: f.size ? Number(f.size) : null,
      }
      if (f.mimeType === GOOGLE_DOC && f.name.includes(TRANSCRIPT_MARKER)) transcripts.push(file)
      else if (f.mimeType.startsWith('video/')) recordings.push(file)
    }
    pageToken = data.nextPageToken
  } while (pageToken && transcripts.length < (opts.limit ?? 200))

  // A recording is "covered" when a transcript shares its meeting title — Meet
  // names the pair identically up to the trailing " - Transcript".
  const covered = new Set(
    transcripts.map((t) => t.name.replace(/\s*-\s*Transcript\s*$/i, '').trim().toLowerCase())
  )
  const uncovered = recordings.filter(
    (r) => !covered.has(r.name.replace(/\.[a-z0-9]+$/i, '').trim().toLowerCase())
  ).length

  return {
    transcripts: opts.limit ? transcripts.slice(0, opts.limit) : transcripts,
    recordingsWithoutTranscript: uncovered,
    noMeetFolder: false,
  }
}
