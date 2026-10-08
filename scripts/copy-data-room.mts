/**
 * Take our own copy of a counterparty's data room, filed into the deal's folder.
 *
 *   node --no-deprecation --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/copy-data-room.mts --source <folderId> --record "<name>" [--apply]
 *
 * Dry run by default; writes a manifest to /tmp/data-room-manifest.tsv either
 * way. Reviewing that manifest is the point — "copy what matters" is a judgement
 * a person makes, so this prints the whole room with a proposed destination per
 * file and copies only once told to.
 *
 * Built for the Steelton room: folder `1otDcbRYuV7828E0ap1IoIxvfOSYQCugg`, 175
 * files in 29 folders, owned by rebecca@zenthium.ai with subfolders owned by
 * tseibert@harvesttimeholdings.com, shared read-only with moose@.
 *
 * ⚠ NO NEW SCOPE. Reading the room is `drive.readonly`; writing lands in a
 * folder this app created, which is `drive.file`. Both are already held. We copy
 * rather than index in place because the share is the counterparty's to revoke
 * and the diligence record is the thing we need to keep.
 *
 * ⚠ WE NEVER WRITE INTO THE SOURCE. Not a rename, not a folder, nothing. It is
 * someone else's room and moose@ has no right to it beyond reading.
 *
 * ⚠ DEDUPE IS ON `md5Checksum`, NEVER ON NAME OR SIZE (§12, 09-25 — four title
 * commitments shared a file name and sat within 1.1% of each other). That is
 * also what makes a re-run safe after the counterparty adds files: already-held
 * bytes are skipped, new ones are copied.
 */

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import { listFolder } from '@/lib/integrations/google-drive'
import { uploadToFolder } from '@/lib/integrations/google-drive-write'
import {
  PRIMARY_MAILBOX,
  getAccessToken,
  isGoogleConfigured,
} from '@/lib/integrations/google-workspace'
import { classifyByFilename, classifyBySourceFolder, driveFolderName, DILIGENCE_PATHS, STANDARD_FOLDERS, UNSORTED_FOLDER } from '@/lib/drive/classify'
import { ensureFolderPath, isFileable } from '@/lib/drive/file-document'

const G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', D = '\x1b[2m', B = '\x1b[1m', O = '\x1b[0m'

const APPLY = process.argv.includes('--apply')
const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

const SOURCE_ID = arg('--source')
const RECORD_NAME = arg('--record')
const MANIFEST_PATH = '/tmp/data-room-manifest.tsv'

/** The same ceiling the importer and the filer apply. */
const MAX_FILE_BYTES = 30 * 1024 * 1024

/**
 * Where a data-room folder's contents belong.
 *
 * Keyed on the room's OWN folder names, read from the room rather than guessed.
 * A VDR is organised one folder per diligence line item — "Title V Permit",
 * "Will Serve", "Zoning Document", several holding a single file — which is an
 * index against a checklist, not a working file system. This is the translation.
 */
function destinationFor(fileName: string, relativeFolder: string): { folder: string; reason: string } {
  const candidates = [...STANDARD_FOLDERS, ...DILIGENCE_PATHS]

  // ⚠ THE ROOM'S OWN FOLDER NAME FIRST, AND BY WORD RATHER THAN BY EXACT NAME.
  // This used to be a ROOM_MAP keyed on Steelton's literal folder names, which
  // measured 24% there and 0-6% on Weirton — the same diligence lines, different
  // wording ("Railroad Information" vs "Railway Information"). The rule now
  // lives in src/lib/drive/classify.ts so the live filing path can use it too,
  // and matches the distinguishing word.
  const byFolder = classifyBySourceFolder(relativeFolder, candidates)
  if (byFolder?.folderName) return { folder: byFolder.folderName, reason: byFolder.reason }

  const byName = classifyByFilename(fileName, candidates)
  if (byName?.folderName) return { folder: byName.folderName, reason: byName.reason }

  const leaf = relativeFolder.split('/').filter(Boolean).pop() ?? ''
  return { folder: UNSORTED_FOLDER, reason: leaf ? `no rule for "${leaf.trim()}"` : 'loose in the room root' }
}

/**
 * What this record's Drive folder ALREADY holds, by content.
 *
 * Read from Drive rather than from `documents`: there is no checksum column on
 * either document table, and adding one to answer "have we got this file" would
 * be a migration in service of a question Drive already answers about the exact
 * folder we are about to write into. Self-correcting, too — if a copy is deleted
 * by hand, the next run brings it back.
 *
 * Returns BOTH sets because Google-native files (a Doc, a Sheet) have no
 * `md5Checksum` at all: there are no canonical bytes to hash. For those, and
 * only those, the file name inside this record is the key — weaker, and said so
 * out loud at the call site rather than silently treated as equivalent.
 */
async function heldAlready(folderId: string): Promise<{ checksums: Set<string>; names: Set<string> }> {
  const token = await getAccessToken(PRIMARY_MAILBOX)
  const checksums = new Set<string>()
  const names = new Set<string>()

  async function walk(id: string, depth: number): Promise<void> {
    if (depth > 4) return
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        q: `'${id}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, md5Checksum)',
        pageSize: '200',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      })
      if (pageToken) params.set('pageToken', pageToken)
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = (await res.json()) as {
        files?: Array<{ id: string; name: string; mimeType: string; md5Checksum?: string }>
        nextPageToken?: string
        error?: { message: string }
      }
      if (body.error) throw new Error(`could not read the destination folder: ${body.error.message}`)
      for (const f of body.files ?? []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          await walk(f.id, depth + 1)
          continue
        }
        if (f.md5Checksum) checksums.add(f.md5Checksum)
        names.add(f.name)
      }
      pageToken = body.nextPageToken
    } while (pageToken)
  }

  await walk(folderId, 1)
  return { checksums, names }
}

async function main(): Promise<void> {
  if (!isGoogleConfigured()) {
    console.error('Google Workspace is not configured — nothing to do.')
    process.exit(1)
  }
  if (!SOURCE_ID || !RECORD_NAME) {
    console.error('Usage: --source <driveFolderId> --record "<project or opportunity name>" [--apply]')
    process.exit(1)
  }

  console.log(`\n${B}=== Data room copy ===${O}`)
  console.log(APPLY ? `${G}APPLY${O} — files will be copied\n` : `${Y}DRY RUN${O} — nothing will be copied (pass --apply)\n`)

  // Resolve the destination record.
  const supabase = createAdminClient()
  let kind: 'project' | 'opportunity' = 'project'
  let record: { id: string; name: string; drive_source_folder_id: string | null } | null = null

  for (const k of ['project', 'opportunity'] as const) {
    const { data } = await supabase
      .from(k === 'project' ? 'projects' : 'opportunities')
      .select('id, name, drive_source_folder_id')
      .eq('name', RECORD_NAME)
      .maybeSingle()
    if (data) {
      kind = k
      record = data as { id: string; name: string; drive_source_folder_id: string | null }
      break
    }
  }
  if (!record) {
    console.error(`${R}No project or opportunity named "${RECORD_NAME}".${O}`)
    process.exit(1)
  }
  if (!record.drive_source_folder_id) {
    console.error(`${R}"${RECORD_NAME}" has no Drive folder. Run setup-drive-structure.mts --apply first.${O}`)
    process.exit(1)
  }
  console.log(`${D}destination: ${kind} "${record.name}" → ${driveFolderName(record.name)}${O}`)

  const files = await listFolder(SOURCE_ID, { maxDepth: 8 })
  const held = await heldAlready(record.drive_source_folder_id)
  console.log(
    `${D}room: ${files.length} files   already in our folder: ${held.checksums.size} by checksum, ${held.names.size} by name${O}\n`
  )

  const token = await getAccessToken(PRIMARY_MAILBOX)
  const manifest: string[] = ['source\tdestination\tsize\treason']
  const counts = { copied: 0, planned: 0, tooBig: 0, alreadyHeld: 0, notAFile: 0, failed: 0 }

  for (const file of files) {
    const rel = file.path ?? ''
    const label = rel ? `${rel}/${file.name}` : file.name

    if (!isFileable(file.name, file.mimeType)) {
      counts.notAFile++
      continue
    }
    if ((file.size ?? 0) > MAX_FILE_BYTES) {
      // Named, never silently skipped — an unlabelled count is not a coverage
      // signal (§12, 09-27).
      console.log(`  ${Y}big ${O}  ${label} ${D}(${Math.round((file.size ?? 0) / 1024 / 1024)}MB > 30MB ceiling)${O}`)
      counts.tooBig++
      continue
    }

    // Ask Drive for the bytes' checksum before downloading them.
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}?fields=md5Checksum&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const meta = (await metaRes.json()) as { md5Checksum?: string }
    const checksum = meta.md5Checksum ?? null

    // Bytes first. Only a Google-native file with no checksum of its own falls
    // back to the name, and that fallback is this script's weakest link: two
    // different "Site Overview" Docs would look like one.
    if (checksum ? held.checksums.has(checksum) : held.names.has(file.name)) {
      counts.alreadyHeld++
      continue
    }

    const { folder, reason } = destinationFor(file.name, rel)
    manifest.push(`${label}\t${folder}\t${file.size ?? 0}\t${reason}`)
    counts.planned++

    if (!APPLY) {
      console.log(`  ${Y}plan${O}  ${label}  ${D}→${O}  ${folder} ${D}(${reason})${O}`)
      continue
    }

    try {
      const dl = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!dl.ok) throw new Error(`download ${dl.status}`)
      const bytes = await dl.arrayBuffer()

      const dest = await ensureFolderPath(folder, record.drive_source_folder_id)
      await uploadToFolder({
        folderId: dest.id,
        name: file.name,
        mimeType: file.mimeType || 'application/octet-stream',
        bytes,
      })
      if (checksum) held.checksums.add(checksum)
      held.names.add(file.name)
      console.log(`  ${G}copy${O}  ${label}  ${D}→${O}  ${folder}`)
      counts.copied++
    } catch (err) {
      console.log(`  ${R}fail${O}  ${label} — ${err instanceof Error ? err.message : err}`)
      counts.failed++
    }
  }

  writeFileSync(MANIFEST_PATH, manifest.join('\n') + '\n', 'utf8')

  // Every source file reconciled, with the REASON beside each number.
  const reconciled =
    counts.copied + counts.planned * (APPLY ? 0 : 1) + counts.tooBig + counts.alreadyHeld + counts.notAFile + counts.failed
  console.log(
    `\n${B}room: ${files.length}  ${APPLY ? `copied: ${counts.copied}` : `to copy: ${counts.planned}`}  ` +
      `over 30MB: ${counts.tooBig}  already held: ${counts.alreadyHeld}  not a document: ${counts.notAFile}  failed: ${counts.failed}${O}`
  )
  if (reconciled !== files.length) {
    console.log(`${R}⚠ ${files.length - reconciled} files unaccounted for — the counts do not reconcile.${O}`)
  }
  console.log(`${D}manifest: ${MANIFEST_PATH}${O}`)
  if (!APPLY) console.log(`${Y}Dry run — review the manifest, then re-run with --apply.${O}`)
  console.log()
}

main().catch((err) => {
  console.error('\nFailed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
