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
  /**
   * The folder this file was listed from.
   *
   * Set by {@link listFolder}'s walk, which knows it for free — it is the folder
   * whose children it is reading. Carried because Drive's legacy multi-parent
   * model makes a move a PATCH with BOTH `addParents` and `removeParents`, and
   * a move that only adds leaves the file in two places while reporting success.
   */
  parentId?: string
  /** Opens the file in Drive. Absent from responses that did not ask for it. */
  webViewLink?: string
  /**
   * Who last touched the file — the closest Drive gets to "who uploaded this".
   * For a file created and never edited, this IS the uploader. Verified to carry
   * a real Workspace address (`tuaone@berwilson.com`) under `drive.readonly`.
   */
  modifiedByName?: string
  modifiedByEmail?: string
}

interface DriveUser {
  displayName?: string
  emailAddress?: string
}

interface DriveListResponse {
  files?: Array<{
    id: string
    name: string
    mimeType: string
    modifiedTime: string
    size?: string
    webViewLink?: string
    lastModifyingUser?: DriveUser
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
 * The team's own folder that generated quote PDFs are filed into —
 * `Prefab Steel Projects / Utah / Quotes folder` on the shared drive.
 *
 * ⚠ WRITING HERE WORKS UNDER `drive.file`, WHICH CONTRADICTS WHAT THIS REPO
 * PREVIOUSLY RECORDED. The note at CLAUDE.md:389 said the platform could not
 * write into a folder a human created. Measured on 2026-09-16 against this
 * exact folder with a token narrowed to `drive.file` alone: creating a file
 * with `parents: [thatFolder]` returns 200. On a SHARED DRIVE the two
 * permissions are separate questions — `drive.file` governs which files the app
 * may touch afterwards (its own), while whether it may add a child is the
 * impersonated user's own right, and moose@ reports `canAddChildren: true`.
 * The old note was true of a My Drive folder, not of this.
 *
 * One asymmetry that follows and matters: the app can create and TRASH here but
 * `canDelete` is false, so cleanup has to trash rather than hard-delete.
 *
 * Unset means quotes stay in the platform's own deal folder — a configuration
 * choice, not a fault.
 */
export function steelQuotesFolderId(): string | null {
  return process.env.STEEL_QUOTES_FOLDER_ID?.trim() || null
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
  const n = name.trim().toLowerCase()
  // The redirect stubs left by the 2026-10-08 restructure. An emptied folder is
  // KEPT and renamed "… (moved — see …)" so a bookmark still opens and explains
  // itself; descending into one would re-import whatever has since been dropped
  // in it under the OLD record's name. Treated as an archive for the same
  // reason archives are: the convention is that putting something there retires it.
  if (n.includes('(moved —') || n.includes('(moved -')) return true
  return ARCHIVE_FOLDER_NAMES.has(n)
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
        // lastModifyingUser + webViewLink are what let an import say WHO added a
        // document and link straight to it. Both are free in the same listing —
        // asking per file afterwards would be one round trip per document.
        fields:
          'nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink, lastModifyingUser(displayName, emailAddress))',
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
          parentId: id,
          webViewLink: f.webViewLink,
          modifiedByName: f.lastModifyingUser?.displayName,
          modifiedByEmail: f.lastModifyingUser?.emailAddress,
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

/**
 * Folders anywhere the mailbox can see whose NAME contains a term.
 *
 * The one-level-at-a-time browser is right for exploring, and wrong for "where
 * is this project's folder" — the team's tree nests business line → project, so
 * finding one folder is three or four round trips of guessing. Searching by
 * name gets there in one, and the caller still decides which hit is correct.
 *
 * Drive's `contains` is a prefix-ish word match, not a substring match, which
 * is why callers should pass a distinctive WORD rather than a full record name.
 * Archive shelves are dropped for the same reason `listFolder` skips them: a
 * retired copy is never the folder someone means to link.
 */
export async function findFoldersByName(
  term: string,
  opts: { mailbox?: string; limit?: number } = {}
): Promise<Array<DriveFile & { parentName: string | null }>> {
  const mailbox = opts.mailbox ?? PRIMARY_MAILBOX
  const cleaned = term.replace(/['\\]/g, ' ').trim()
  if (cleaned.length < 3) return []

  const params = new URLSearchParams({
    q: `name contains '${cleaned}' and mimeType = '${GOOGLE_FOLDER}' and trashed = false`,
    fields: 'files(id, name, mimeType, modifiedTime, parents)',
    pageSize: String(opts.limit ?? 25),
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
  })

  const data = await googleFetch<{ files?: Array<DriveFile & { parents?: string[] }> }>(
    `${DRIVE_BASE}/files?${params.toString()}`,
    mailbox
  )

  const hits = (data.files ?? []).filter((f) => !isArchiveFolder(f.name))

  // The parent's name is what disambiguates two folders with the same short
  // name — "Utah / Mira Vista" against "Housing Development / Mira Vista".
  const parentIds = [...new Set(hits.map((f) => f.parents?.[0]).filter(Boolean))] as string[]
  const parentName = new Map<string, string>()
  await Promise.all(
    parentIds.map(async (id) => {
      try {
        const p = await googleFetch<{ name?: string }>(
          `${DRIVE_BASE}/files/${id}?fields=name&supportsAllDrives=true`,
          mailbox
        )
        if (p.name) parentName.set(id, p.name)
      } catch {
        /* a parent we cannot read is not worth failing the search over */
      }
    })
  )

  return hits.map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    size: null,
    parentName: f.parents?.[0] ? parentName.get(f.parents[0]) ?? null : null,
  }))
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
 * A folder's own name.
 *
 * `listFolder` returns each file's path BELOW the folder it was handed, so a
 * file sitting directly in a nominated folder has an empty path — which tells a
 * reader nothing about where it came from. The nominated folder's own name is
 * the missing half, and it is what makes "which shelf is leaking deal
 * material" an answerable question.
 *
 * Returns null rather than throwing: an unreadable folder should cost the path
 * label on its files, never the whole sync.
 */
export async function getFolderName(
  folderId: string,
  opts: { mailbox?: string } = {}
): Promise<string | null> {
  const mailbox = opts.mailbox ?? PRIMARY_MAILBOX
  try {
    const data = await googleFetch<{ name?: string }>(
      `${DRIVE_BASE}/files/${folderId}?fields=name&supportsAllDrives=true`,
      mailbox
    )
    return data.name ?? null
  } catch (err) {
    console.error(`[drive] could not read folder name for ${folderId}:`, err)
    return null
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
 * Where Google Meet drops recordings and transcripts: a folder in the
 * ORGANIZER's My Drive. There is no API to ask for it by role, so it is resolved
 * by name, with an env override for a Workspace that files them elsewhere.
 *
 * ⚠ The name is not stable. Google has used both "Meet Recordings" and, more
 * recently, "Google Meet", and it is locale-dependent besides. Matching only the
 * older name is why this importer ran 192 times and imported nothing: it
 * reported "no Meet folder" against a Drive that had one, under the newer name,
 * holding every meeting. Hence a LIST — add to it rather than swapping it.
 */
export const MEET_FOLDER_NAMES = ['Meet Recordings', 'Google Meet'] as const

/**
 * Meet names its artifact docs "<title> - <timestamp> - Transcript" or
 * "<title> - <timestamp> - Notes by Gemini". Both are wanted: where Gemini took
 * notes, ITS document is the better one — the recap and the full transcript
 * arrive in a single file, so the transcript-only doc is redundant.
 */
const TRANSCRIPT_MARKER = 'Transcript'
const NOTES_MARKER = 'Notes by Gemini'

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
  /** True when no Meet folder exists in this Drive at all. */
  noMeetFolder: boolean
}

/** Explicit folder id override, for Workspaces that file Meet output elsewhere. */
export function meetFolderIdOverride(): string | null {
  return process.env.GOOGLE_MEET_FOLDER_ID?.trim() || null
}

/** Resolve the Meet output folder id in a mailbox's Drive, if it exists. */
async function findMeetFolder(mailbox: string): Promise<string | null> {
  const override = meetFolderIdOverride()
  if (override) return override

  const byName = MEET_FOLDER_NAMES.map((n) => `name = '${n}'`).join(' or ')
  const params = new URLSearchParams({
    q: `mimeType = '${GOOGLE_FOLDER}' and (${byName}) and trashed = false`,
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

  // Meet writes one SUBFOLDER per meeting ("<title> - 2026/09/25 10:58 MDT")
  // and puts the artifacts inside it. A flat `'<folderId>' in parents` listing
  // therefore sees nothing but folders — which is the second half of why this
  // importer never returned a file.
  //
  // maxDepth 2, not 1: listFolder counts the folder it was handed as level 1, so
  // 2 is "this folder and the meeting folders in it" and stops there. Measured
  // against the live Drive — 1 returns nothing at all.
  const files = await listFolder(folderId, { mailbox, maxDepth: 2 })

  const transcripts: DriveFile[] = []
  const recordings: DriveFile[] = []
  const sinceMs = opts.since ? Date.parse(opts.since) : 0

  for (const file of files) {
    // Drive has no server-side filter here (listFolder lists a tree), so the
    // first-run bound is applied in memory. A Meet folder holds one small
    // listing per meeting, never the thousands that made this worth pushing
    // server-side elsewhere. Compared as INSTANTS — never string-compare two
    // timestamps that may not share a format (§12).
    if (opts.since && Date.parse(file.modifiedTime) <= sinceMs) continue

    // GOOGLE_DOC only, which quietly does one more job: when several people on
    // the call are executives, Meet puts the real document in the ORGANIZER's
    // Drive and a `…apps.shortcut` to it in each other participant's. Both
    // mailboxes are read, so the real document is always seen once — and
    // ignoring shortcuts is what stops one meeting importing twice. (Verified
    // live: moose@ holds the three documents, tuaone@ holds three shortcuts.)
    if (file.mimeType === GOOGLE_DOC && isMeetArtifactName(file.name)) transcripts.push(file)
    else if (file.mimeType.startsWith('video/')) recordings.push(file)
  }

  // Newest first — the same order the old server-side query returned, and the
  // order the per-run limit should truncate.
  transcripts.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))

  // ONE MEETING MUST YIELD ONE SESSION. Where Gemini took notes, Meet may file
  // both "<title> - Notes by Gemini" and "<title> - Transcript"; the notes
  // document already contains the transcript, so keeping both would stage every
  // meeting twice and put the reviewer in front of the same call written two
  // ways. Group on the meeting title and prefer the notes document.
  const byMeeting = new Map<string, DriveFile>()
  for (const f of transcripts) {
    const key = meetArtifactKey(f.name)
    const held = byMeeting.get(key)
    if (!held || (!isGeminiNotesName(held.name) && isGeminiNotesName(f.name))) {
      byMeeting.set(key, f)
    }
  }
  const chosen = [...byMeeting.values()].sort((a, b) =>
    b.modifiedTime.localeCompare(a.modifiedTime)
  )

  // A recording is "covered" when an artifact shares its meeting title.
  const covered = new Set(chosen.map((t) => meetArtifactKey(t.name)))
  const uncovered = recordings.filter(
    (r) => !covered.has(meetArtifactKey(r.name.replace(/\.[a-z0-9]+$/i, '')))
  ).length

  return {
    transcripts: opts.limit ? chosen.slice(0, opts.limit) : chosen,
    recordingsWithoutTranscript: uncovered,
    noMeetFolder: false,
  }
}

/** True when a Drive file name looks like Meet's Gemini note-taker output. */
function isGeminiNotesName(name: string): boolean {
  return name.includes(NOTES_MARKER)
}

/** True for either kind of Meet artifact document. */
function isMeetArtifactName(name: string): boolean {
  return name.includes(TRANSCRIPT_MARKER) || isGeminiNotesName(name)
}

/** The meeting a Meet artifact belongs to: its name with the artifact suffix
 *  stripped. Two files sharing this key describe the same call. */
function meetArtifactKey(name: string): string {
  return name
    .replace(/\s*-\s*(Notes by Gemini|Transcript)\s*$/i, '')
    .trim()
    .toLowerCase()
}
