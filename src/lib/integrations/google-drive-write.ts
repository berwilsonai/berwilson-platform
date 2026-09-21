/**
 * Drive writes — a folder per record, reachable without the tailnet.
 *
 * The problem this solves is physical, not technical: bid documents live in
 * Supabase Storage on a Mac Studio that only reaches devices on the tailnet, so
 * the estimator who needs the plans often cannot open them. Publishing a
 * record's documents into a Drive folder puts them where the whole company
 * already works, on any device, with no VPN.
 *
 * Scoped to `drive.file`, which is the important detail. That scope grants
 * access to files THIS APP CREATED and to nothing else — it cannot read, edit,
 * or delete anything a person put in Drive. It is therefore safe to hold
 * alongside the read-only knowledge-folder scope: the platform can publish into
 * its own tree and is blind to the rest of the Drive.
 *
 * A consequence worth knowing: because the app can only see its own files, the
 * root folder cannot be a folder id pasted from the console — it must be one the
 * platform created. So it creates it, and finds it again by name. That is also
 * why there is no "point this at an existing folder" setting.
 *
 * Plain fetch, no SDK, reusing the auth in google-workspace.ts.
 */

import {
  PRIMARY_MAILBOX,
  explainTokenError,
  getAccessToken,
  googleFetch,
} from './google-workspace'

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DOC_MIME = 'application/vnd.google-apps.document'

/** The tree everything the platform publishes lives under. */
export const ROOT_FOLDER_NAME = 'Ber Intelligence'

/** Thrown when the mailbox's stored consent predates drive.file. */
export class DriveScopeError extends Error {
  constructor(mailbox: string) {
    super(
      `${mailbox} has not granted the drive.file scope, so the platform cannot publish documents to Drive. ` +
        `Re-consent that mailbox with: node scripts/setup-google-oauth.mjs --only ${mailbox}`
    )
    this.name = 'DriveScopeError'
  }
}

export interface DriveFileRef {
  id: string
  name: string
  webViewLink?: string
  /**
   * Drive's own modified timestamp, requested at upload.
   *
   * Load-bearing for anything filed into a folder the importer also READS:
   * `driveFileUnchanged(null, file)` returns false, so a row stored without
   * this is re-downloaded, re-summarized and re-embedded on every nightly run.
   * That exact bug has already been paid for once in this repo.
   */
  modifiedTime?: string
}

/** Drive meters by request; a burst of uploads hits it routinely. */
const WRITE_ATTEMPTS = 4
const WRITE_BACKOFF_MS = 2000

/**
 * A throttled write is not a failed write.
 *
 * This had no retry at all, unlike `googleRequest` in google-workspace.ts, so
 * one 429 during a filing run lost that document until the next nightly pass.
 * Retried narrowly and deliberately: 429 and a 403 whose body says "quota" mean
 * slow down, while a 403 that means "no permission" must fail immediately
 * rather than making the operator wait out the backoff for the message they
 * need. Network-shaped errors retry too -- the Studio's DarkWake windows
 * produce them, and that was a whole class of spurious Drive failures.
 */
function isRetryableWrite(status: number, body: string): boolean {
  if (status === 429 || status === 500 || status === 502 || status === 503) return true
  return status === 403 && /quota|rate limit|userRateLimitExceeded|backendError/i.test(body)
}

async function driveWrite<T>(
  mailbox: string,
  url: string,
  init: RequestInit
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, WRITE_BACKOFF_MS * 2 ** (attempt - 1)))
    }

    let res: Response
    try {
      // Minted inside the loop: token refresh dies the same network-shaped way
      // the request does, and a stale token is a reason to try again.
      const token = await getAccessToken(mailbox)
      res = await fetch(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      })
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      continue
    }

    if (res.ok) return res.json() as Promise<T>

    const body = await res.text()
    if (res.status === 403 && /insufficient|scope/i.test(body)) throw new DriveScopeError(mailbox)

    const path = url.split('?')[0].replace(/https:\/\/[^/]+/, '')
    lastError = new Error(`Drive ${path} failed: ${res.status} — ${explainTokenError(body)}`)
    if (!isRetryableWrite(res.status, body)) throw lastError
  }

  throw lastError ?? new Error('Drive write failed')
}

/** The Workspace domain, taken from the mailbox we act as. */
function workspaceDomain(mailbox: string): string | null {
  return mailbox.split('@')[1]?.trim().toLowerCase() || null
}

/**
 * Give the whole Workspace domain read access to a file or folder.
 *
 * Domain-wide rather than per-person invitations: the point is that anyone who
 * needs the plans can open them without asking, and a share list that has to be
 * maintained is a share list that will be out of date the week someone joins.
 * Reader, not writer — Ber Intelligence stays the place documents are changed.
 */
export async function shareWithDomain(fileId: string, mailbox: string): Promise<void> {
  const domain = workspaceDomain(mailbox)
  if (!domain) return

  try {
    await driveWrite(mailbox, `${DRIVE_BASE}/files/${fileId}/permissions?sendNotificationEmail=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'domain', role: 'reader', domain }),
    })
  } catch (err) {
    // A sharing policy that forbids domain links is a legitimate configuration,
    // not a failure of the publish — the folder still exists and its owner can
    // share it by hand.
    console.warn(
      '[drive-write] could not share with the domain:',
      err instanceof Error ? err.message : err
    )
  }
}

/**
 * Make sure the folder is readable by the whole Workspace domain, adding the
 * permission only if it is genuinely absent.
 *
 * Sharing otherwise happens exactly once, when the root is created. If someone
 * later removes that permission — or the root is recreated by a path that skips
 * it — publishing carries on succeeding while the documents become invisible to
 * everyone except the owning mailbox. That is the worst shape of failure this
 * integration can have: the platform reports "published", the folder fills up,
 * and the people it was published FOR see an empty Drive.
 *
 * Cheap enough to verify on every nightly run, so it does.
 */
export async function ensureDomainShared(fileId: string, mailbox: string): Promise<boolean> {
  const domain = workspaceDomain(mailbox)
  if (!domain) return false

  try {
    const data = await googleFetch<{
      permissions?: { type?: string; role?: string; domain?: string }[]
    }>(
      `${DRIVE_BASE}/files/${fileId}/permissions?fields=permissions(type,role,domain)&supportsAllDrives=true`,
      mailbox
    )
    const shared = (data.permissions ?? []).some(
      (p) => p.type === 'domain' && p.domain === domain
    )
    if (shared) return true
  } catch {
    // Fall through and try to share: a failed read must not leave the folder
    // unshared on the assumption that it probably was.
  }

  await shareWithDomain(fileId, mailbox)
  return false
}

/** Find a folder by exact name under a parent, among files the app created. */
async function findFolder(
  mailbox: string,
  name: string,
  parentId: string
): Promise<DriveFileRef | null> {
  const q = [
    `mimeType = '${FOLDER_MIME}'`,
    `name = '${name.replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    'trashed = false',
  ].join(' and ')

  const params = new URLSearchParams({
    q,
    fields: 'files(id, name, webViewLink)',
    pageSize: '10',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })

  const data = await googleFetch<{ files?: DriveFileRef[] }>(
    `${DRIVE_BASE}/files?${params.toString()}`,
    mailbox
  )
  return data.files?.[0] ?? null
}

async function createFolder(
  mailbox: string,
  name: string,
  parentId: string
): Promise<DriveFileRef> {
  return driveWrite<DriveFileRef>(
    mailbox,
    `${DRIVE_BASE}/files?fields=id,name,webViewLink,modifiedTime&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    }
  )
}

/**
 * Resolve a folder, creating it if absent. Cached for the life of the process —
 * publishing twenty documents should not re-resolve the same folder twenty times.
 */
const folderCache = new Map<string, DriveFileRef>()

export async function ensureFolder(
  name: string,
  parentId: string,
  mailbox: string = PRIMARY_MAILBOX
): Promise<DriveFileRef> {
  const key = `${mailbox}::${parentId}::${name}`
  const cached = folderCache.get(key)
  if (cached) return cached

  const found = (await findFolder(mailbox, name, parentId)) ?? (await createFolder(mailbox, name, parentId))
  folderCache.set(key, found)
  return found
}

/** The app-owned root, created on first use and shared with the domain. */
export async function ensureRootFolder(mailbox: string = PRIMARY_MAILBOX): Promise<DriveFileRef> {
  const key = `${mailbox}::root`
  const cached = folderCache.get(key)
  if (cached) return cached

  const existing = await findFolder(mailbox, ROOT_FOLDER_NAME, 'root')
  if (existing) {
    folderCache.set(key, existing)
    return existing
  }

  const created = await createFolder(mailbox, ROOT_FOLDER_NAME, 'root')
  // Shared once, at creation. Everything beneath inherits, so per-record folders
  // never need their own permission call.
  await shareWithDomain(created.id, mailbox)
  folderCache.set(key, created)
  return created
}

export interface UploadInput {
  folderId: string
  name: string
  mimeType: string
  bytes: ArrayBuffer | Buffer
  mailbox?: string
}

/**
 * Upload one file into a folder. Returns the created file's id and link.
 *
 * Multipart rather than resumable: bid documents are PDFs measured in megabytes,
 * and resumable uploads add a round trip plus session state for a robustness
 * nothing here needs. Revisit if a >100MB drawing set ever shows up.
 */
export async function uploadToFolder(input: UploadInput): Promise<DriveFileRef> {
  const mailbox = input.mailbox ?? PRIMARY_MAILBOX
  const buf = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes)
  const boundary = `bwdrive_${Math.abs(hashString(input.name + buf.length)).toString(36)}`

  const metadata = JSON.stringify({ name: input.name, parents: [input.folderId] })
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${input.mimeType || 'application/octet-stream'}\r\n\r\n`,
      'utf8'
    ),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ])

  return driveWrite<DriveFileRef>(
    mailbox,
    `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,webViewLink,modifiedTime&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    }
  )
}

/** Find a non-folder file by exact name under a parent. */
export async function findFile(
  mailbox: string,
  name: string,
  parentId: string
): Promise<DriveFileRef | null> {
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    'trashed = false',
  ].join(' and ')

  const params = new URLSearchParams({
    q,
    fields: 'files(id, name, webViewLink)',
    pageSize: '10',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })

  const data = await googleFetch<{ files?: DriveFileRef[] }>(
    `${DRIVE_BASE}/files?${params.toString()}`,
    mailbox
  )
  return data.files?.[0] ?? null
}

/**
 * Create or refresh a native Google Sheet from CSV.
 *
 * Deliberately goes through Drive's CSV conversion rather than the Sheets API.
 * Three things fall out of that choice, all of them the point:
 *
 *  - **No new API and no new scope.** Drive is already enabled and proven;
 *    reaching for Sheets would mean enabling another API on the Cloud project,
 *    which has already been a stumbling block twice.
 *  - **The file id is stable.** Refreshing writes new media to the SAME file, so
 *    the link a rep bookmarked and any access granted to an outside collaborator
 *    both survive every nightly rebuild. Deleting and recreating would silently
 *    revoke a share and break a saved link once a day.
 *  - **Whole-sheet replace.** The platform owns every row; there is no merge to
 *    get wrong, which is what keeps this a read-only projection rather than a
 *    second source of truth.
 *
 * Looked up by name rather than stored, unlike the per-record folders: there is
 * exactly one sheet per route and the name is generated, so the ambiguity that
 * forced those to create-not-find cannot arise here.
 */
export async function upsertSheetFromCsv(input: {
  folderId: string
  /** File name shown in Drive. Also the lookup key, so keep it stable. */
  name: string
  csv: string
  mailbox?: string
}): Promise<{ ref: DriveFileRef; created: boolean }> {
  const mailbox = input.mailbox ?? PRIMARY_MAILBOX
  const media = Buffer.from(input.csv, 'utf8')

  const existing = await findFile(mailbox, input.name, input.folderId)
  if (existing) {
    await driveWrite(
      mailbox,
      `${DRIVE_UPLOAD}/${existing.id}?uploadType=media&supportsAllDrives=true`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'text/csv' },
        body: new Uint8Array(media),
      }
    )
    return { ref: existing, created: false }
  }

  const boundary = `bwsheet_${Math.abs(hashString(input.name + media.length)).toString(36)}`
  // The metadata mimeType is what tells Drive to CONVERT the uploaded CSV into a
  // real Sheet instead of storing it as an attached file.
  const metadata = JSON.stringify({
    name: input.name,
    parents: [input.folderId],
    mimeType: SHEET_MIME,
  })
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: text/csv\r\n\r\n`,
      'utf8'
    ),
    media,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ])

  const ref = await driveWrite<DriveFileRef>(
    mailbox,
    `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,webViewLink,modifiedTime&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    }
  )
  return { ref, created: true }
}

/**
 * A boundary that cannot collide with the payload.
 *
 * Deterministic rather than random because workflow scripts and tests re-run
 * the same upload and a stable boundary makes the request reproducible; the only
 * requirement is that the string does not occur in the body, which a hash of the
 * name and length satisfies in practice.
 */
function hashString(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0
  return h
}

/**
 * Copy an app-created file into an app-created folder.
 *
 * Used to stamp out a quote from the template Doc. Verified to work under
 * `drive.file` alone (2026-09-16), which is why the template must itself be
 * app-created: that scope is a per-file grant, and a Doc a human uploaded by
 * hand is invisible to it however readable it is through drive.readonly.
 */
export async function copyFile(
  fileId: string,
  name: string,
  folderId: string,
  mailbox: string = PRIMARY_MAILBOX
): Promise<DriveFileRef> {
  return driveWrite<DriveFileRef>(
    mailbox,
    `${DRIVE_BASE}/files/${fileId}/copy?fields=id,name,webViewLink&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [folderId] }),
    }
  )
}

/**
 * Upload bytes and let Drive convert them into a native Google Doc.
 *
 * The same conversion trick `upsertSheetFromCsv` uses for CSV → Sheet. Seeding
 * the quote template from Richard's own .docx this way preserves the logo,
 * colour callouts, table shading and footer exactly, which hand-authored HTML
 * would not.
 *
 * ⚠ The source .docx must have a paragraph between every pair of adjacent
 * tables. Google merges tables that touch, and a merged callout inherits the
 * width of the table above it — which turned the 4-page reference document into
 * 5 pages with three collapsed callouts. See scripts/build-quote-template.mjs.
 */
export async function createDocFromBytes(input: {
  name: string
  folderId: string
  bytes: Buffer | Uint8Array
  /** Source type, e.g. the .docx mime. Drive converts it to a Google Doc. */
  sourceMimeType: string
  mailbox?: string
}): Promise<DriveFileRef> {
  const mailbox = input.mailbox ?? PRIMARY_MAILBOX
  const buf = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes)
  const boundary = `bwdoc_${Math.abs(hashString(input.name + buf.length)).toString(36)}`

  const metadata = JSON.stringify({
    name: input.name,
    parents: [input.folderId],
    mimeType: DOC_MIME,
  })
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${input.sourceMimeType}\r\n\r\n`,
      'utf8'
    ),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ])

  return driveWrite<DriveFileRef>(
    mailbox,
    `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,webViewLink,modifiedTime&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    }
  )
}

/**
 * Grant the Workspace domain a specific role on ONE file.
 *
 * `shareWithDomain` above is deliberately reader-only for published documents.
 * The quote TEMPLATE is the exception: its whole point is that Richard edits the
 * wording without a deploy, so it needs writer. Scoped to a single file id so
 * granting it can never widen what the rest of the tree allows.
 */
export async function shareFileWithRole(
  fileId: string,
  role: 'reader' | 'writer',
  mailbox: string = PRIMARY_MAILBOX
): Promise<void> {
  const domain = workspaceDomain(mailbox)
  if (!domain) return
  try {
    await driveWrite(
      mailbox,
      `${DRIVE_BASE}/files/${fileId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'domain', role, domain }),
      }
    )
  } catch (err) {
    console.warn(`[drive] could not grant ${role} on ${fileId}:`, err)
  }
}

/** Move a file to the trash. Only ever used to clean up a failed generation. */
export async function trashFile(fileId: string, mailbox: string = PRIMARY_MAILBOX): Promise<void> {
  try {
    await driveWrite(mailbox, `${DRIVE_BASE}/files/${fileId}?supportsAllDrives=true`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    })
  } catch (err) {
    console.warn(`[drive] could not trash ${fileId}:`, err)
  }
}

export function folderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`
}
