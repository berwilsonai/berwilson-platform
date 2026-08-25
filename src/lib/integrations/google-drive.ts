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

export function isDriveConfigured(): boolean {
  return !!driveKnowledgeFolderId()
}

/**
 * List every file in a folder, recursing into subfolders.
 *
 * @param maxDepth Subfolder depth. One level of nesting is plenty for a curated
 *                 folder and stops a mis-pointed id from walking an entire Drive.
 */
export async function listFolder(
  folderId: string,
  opts: { mailbox?: string; maxDepth?: number } = {}
): Promise<DriveFile[]> {
  const mailbox = opts.mailbox ?? PRIMARY_MAILBOX
  const maxDepth = opts.maxDepth ?? 2
  const out: DriveFile[] = []

  async function walk(id: string, depth: number): Promise<void> {
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
          if (depth < maxDepth) await walk(f.id, depth + 1)
          continue
        }
        out.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
          size: f.size ? Number(f.size) : null,
        })
      }
      pageToken = data.nextPageToken
    } while (pageToken)
  }

  await walk(folderId, 1)
  return out
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
