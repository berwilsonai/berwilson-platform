/**
 * Move each record's existing Drive folder into the uniform structure.
 *
 *   node --no-deprecation --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/migrate-drive-structure.mts [--apply] [--only "<record name>"]
 *
 * Dry run by default. It always writes a full manifest to
 * `/tmp/drive-migration-manifest.tsv` — one line per file, `from → to`, with the
 * reason the destination was chosen — because the review of that file IS the
 * safety mechanism here. Re-runnable: a second pass reports 0 moves.
 *
 * ⚠ REQUIRES THE FULL `drive` SCOPE, TEMPORARILY. Everything else the platform
 * does to Drive is additive and works under `drive.file`; re-parenting a file a
 * PERSON created is not (see `moveFile`). The intended sequence is:
 *
 *   1. add 'https://www.googleapis.com/auth/drive' to PRIMARY_ONLY_SCOPES
 *   2. node scripts/setup-google-oauth.mjs --only moose@berwilson.com
 *   3. launchctl kickstart -k gui/$(id -u)/com.berwilson.platform
 *   4. this script, --dry-run then --apply
 *   5. remove the scope, re-consent again, kickstart again
 *
 * It refuses to run without that scope rather than failing file by file.
 *
 * ⚠ IT NEVER DELETES AND IT NEVER MERGES TWO RECORDS. Each record's own linked
 * folder goes to its own `02 Projects/<record>` folder, one to one. Folders
 * holding files that belong to NO record are REPORTED, never moved — "Myton"
 * looked like one deal filed twice and is in fact two records (`Myton
 * Development` → Myton Compute Campus, `Myton Rail` → Myton - Utah) already
 * linked to the two trees. Guessing that those are one deal would have silently
 * collapsed two pipelines into one.
 *
 * ⚠ A MOVE DOES NOT CHANGE A DRIVE FILE ID, so every `documents.drive_file_id`
 * survives this intact and nothing needs re-embedding. What goes stale is
 * `documents.drive_folder_path` — re-run backfill-company-folder-paths.mts after.
 */

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  ensureFolder,
  moveFile,
  renameFile,
} from '@/lib/integrations/google-drive-write'
import { listFolder, listSubfolders } from '@/lib/integrations/google-drive'
import {
  PRIMARY_MAILBOX,
  getAccessToken,
  isGoogleConfigured,
} from '@/lib/integrations/google-workspace'
import {
  classifyByFilename,
  driveFolderName,
  DILIGENCE_FOLDER,
  DILIGENCE_PATHS,
  STANDARD_FOLDERS,
  UNSORTED_FOLDER,
} from '@/lib/drive/classify'
import { ensureFolderPath } from '@/lib/drive/file-document'

const G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', D = '\x1b[2m', B = '\x1b[1m', O = '\x1b[0m'

const APPLY = process.argv.includes('--apply')
const ONLY = (() => {
  const i = process.argv.indexOf('--only')
  return i >= 0 ? process.argv[i + 1] ?? null : null
})()

const MANIFEST_PATH = '/tmp/drive-migration-manifest.tsv'
const PROJECTS_SHELF = '02 Projects'
const HQ_FOLDER_ID = '1RmNqygvuzKeEAMvX_3tAQ0FNszXet0K9'

/**
 * Where a known folder's contents belong, by the folder's own name.
 *
 * Built by reading the 233 folder names actually on this drive, not from
 * imagination — a dictionary written from memory falls through to the raw value
 * for every row while looking authoritative (§12, 09-30). Keys are compared
 * lowercased and trimmed, because 16 of those names carry a trailing space.
 *
 * Anything not named here falls to `classifyByFilename` on the file itself and
 * then to _Unsorted. A guess is never made from the folder name alone.
 */
const FOLDER_MAP: Record<string, string> = {
  // Already standard — identity, so a re-run is a no-op.
  '_unsorted': UNSORTED_FOLDER,
  'contracts & legal': 'Contracts & Legal',
  'correspondence': 'Correspondence',
  'drawings & plans': 'Drawings & Plans',
  'financials': 'Financials',
  'proposals & bids': 'Proposals & Bids',
  'reports & studies': 'Reports & Studies',

  // Land & title
  'deeds': 'Land & Title',
  'koi': 'Land & Title',
  'koi quick claim deeds': 'Land & Title',
  'parcel numbers': 'Land & Title',
  'land legal': 'Land & Title',
  'land tenure documents': 'Land & Title',
  'utah land records': 'Land & Title',
  'cadastral survey field notes (before 1995)': 'Land & Title',
  'cadastral survey plats & field notes (after 1995)': 'Land & Title',
  'family tree': 'Land & Title',

  // Contracts & legal
  'legal': 'Contracts & Legal',
  'organizational documents': 'Contracts & Legal',
  'operating agreement': 'Contracts & Legal',
  'settlement agreements': 'Contracts & Legal',
  'material contracts': 'Contracts & Legal',
  'litigation': 'Contracts & Legal',
  'signed nda': 'Contracts & Legal',

  // Financials
  'k1 form & taxes': 'Financials',
  'balance sheets': 'Financials',
  'income and expense reports': 'Financials',
  'fixed assets': 'Financials',
  'scrap estimates': 'Financials',
  'equipment': 'Financials',

  // Diligence lanes
  'title v permit': `${DILIGENCE_FOLDER}/Permits & Entitlements`,
  'zoning document': `${DILIGENCE_FOLDER}/Permits & Entitlements`,
  'licenses and permits': `${DILIGENCE_FOLDER}/Permits & Entitlements`,
  'utilities': `${DILIGENCE_FOLDER}/Power & Utilities`,
  'will serve': `${DILIGENCE_FOLDER}/Power & Utilities`,
  'will serve letter': `${DILIGENCE_FOLDER}/Power & Utilities`,
  'project steelton power verification': `${DILIGENCE_FOLDER}/Power & Utilities`,
  'steelton single line diagram': `${DILIGENCE_FOLDER}/Power & Utilities`,
  'dura-bond utility access': `${DILIGENCE_FOLDER}/Power & Utilities`,
  'phase 1 enviromental': `${DILIGENCE_FOLDER}/Environmental`,
  'phase i environmental': `${DILIGENCE_FOLDER}/Environmental`,
  'environmental': `${DILIGENCE_FOLDER}/Environmental`,
  'stormwater fees': `${DILIGENCE_FOLDER}/Environmental`,
  'water intake & discharge information': `${DILIGENCE_FOLDER}/Water & Wastewater`,
  'water intake and discharge information': `${DILIGENCE_FOLDER}/Water & Wastewater`,
  'railway information': `${DILIGENCE_FOLDER}/Rail & Transportation`,
  'dueschesne county rail corridor': `${DILIGENCE_FOLDER}/Rail & Transportation`,
  'stracnet rail': `${DILIGENCE_FOLDER}/Rail & Transportation`,
  'site overview': `${DILIGENCE_FOLDER}/Geotech & Site Reports`,
  'site reports-agencies': `${DILIGENCE_FOLDER}/Geotech & Site Reports`,
  'supplemental diligence': `${DILIGENCE_FOLDER}/Geotech & Site Reports`,
  'due diligence': `${DILIGENCE_FOLDER}/Geotech & Site Reports`,

  // Proposals
  'offer': 'Proposals & Bids',
  'previous land offers': 'Proposals & Bids',
  'master proposal - land development': 'Proposals & Bids',
  'master plan proposal - sharkey': 'Proposals & Bids',
  'letters of support': 'Proposals & Bids',
  'stockton loi': 'Proposals & Bids',
  'business plan myton 1': 'Proposals & Bids',

  // Reports / drawings
  'independent re brokers market analysis': 'Reports & Studies',
  'pre construction': 'Drawings & Plans',
  'cp3 - site map layout': 'Drawings & Plans',

  // Insurance
  'insurance information': 'Insurance & Bonding',

  // Deal collateral. Infographics made FOR a pitch are proposal material; the
  // `04 Brand & Media` shelf is for company marketing that belongs to no deal.
  'stockton infographics': 'Proposals & Bids',
  'ian phase 1 docs to sign': 'Contracts & Legal',

  // ⚠ DELIBERATELY ABSENT, and each one is a question for a human rather than a
  // gap in the table:
  //   "IAN Networks EMP Solution  - Chuck Manto" (11 files) sits inside Myton
  //     Compute Campus but there is an `IAN (EMP) Technology aquisition`
  //     OPPORTUNITY with its own folder. Moving it is a cross-record decision,
  //     and this pass never moves a file between two records.
  //   "MIDA" (1 file) — the Military Installation Development Authority is a
  //     counterparty, not a document type; which folder depends on the document.
  // Both land in _Unsorted, which is where an undecided document belongs.
}

interface Move {
  fileId: string
  fileName: string
  fromParentId: string
  fromPath: string
  toFolderId: string | null
  toPath: string
  reason: string
}

interface Record_ {
  id: string
  name: string
  kind: 'project' | 'opportunity'
  linked: string
}

/** Lowercased, trimmed, whitespace-collapsed — the FOLDER_MAP lookup key. */
function mapKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Has this token already got the `drive` scope, or should we stop now? */
async function assertFullDriveScope(): Promise<void> {
  const token = await getAccessToken(PRIMARY_MAILBOX)
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`)
  const info = (await res.json()) as { scope?: string }
  const scopes = (info.scope ?? '').split(' ')
  if (scopes.includes('https://www.googleapis.com/auth/drive')) return

  console.error(`\n${R}${PRIMARY_MAILBOX} does not hold the full 'drive' scope.${O}`)
  console.error(`Moving a file a PERSON created needs it; drive.file is not enough.`)
  console.error(`\n  1. add 'https://www.googleapis.com/auth/drive' to PRIMARY_ONLY_SCOPES`)
  console.error(`     in src/lib/integrations/google-workspace.ts`)
  console.error(`  2. node scripts/setup-google-oauth.mjs --only ${PRIMARY_MAILBOX}`)
  console.error(`  3. launchctl kickstart -k gui/$(id -u)/com.berwilson.platform`)
  console.error(`\nRemember to take it back out afterwards.\n`)
  process.exit(1)
}

async function loadRecords(): Promise<Record_[]> {
  const supabase = createAdminClient()
  const out: Record_[] = []

  const { data: projects, error: pErr } = await supabase
    .from('projects')
    .select('id, name, drive_source_folder_id, confidential')
    .order('name')
  if (pErr) throw new Error(`projects: ${pErr.message}`)
  for (const p of projects ?? []) {
    const r = p as { id: string; name: string | null; drive_source_folder_id: string | null; confidential: boolean | null }
    if (r.confidential === true || !r.name || !r.drive_source_folder_id) continue
    out.push({ id: r.id, name: r.name, kind: 'project', linked: r.drive_source_folder_id })
  }

  const { data: opps, error: oErr } = await supabase
    .from('opportunities')
    .select('id, name, drive_source_folder_id')
    .order('name')
  if (oErr) throw new Error(`opportunities: ${oErr.message}`)
  for (const o of opps ?? []) {
    const r = o as { id: string; name: string | null; drive_source_folder_id: string | null }
    if (!r.name || !r.drive_source_folder_id) continue
    out.push({ id: r.id, name: r.name, kind: 'opportunity', linked: r.drive_source_folder_id })
  }

  return ONLY ? out.filter((r) => r.name === ONLY) : out
}

/** The destination inside the record's new folder, and why. */
function destinationFor(
  fileName: string,
  relativeFolder: string
): { folder: string; reason: string } {
  // The immediate parent folder's own name is the strongest signal: a human put
  // the file there. Only the LAST segment is consulted — an intermediate
  // container ("Utah Land Records/Land Tenure Documents") must not outvote it.
  const leaf = relativeFolder.split('/').filter(Boolean).pop() ?? ''
  const mapped = FOLDER_MAP[mapKey(leaf)]
  if (mapped) return { folder: mapped, reason: `folder "${leaf.trim()}"` }

  // The diligence lanes must be offered here, not just the eleven top-level
  // folders: "Stockton Utah Zoning map.jpg" has a zoning rule and nowhere for it
  // to land without them, so it was going to _Unsorted with a filename that
  // names its own destination.
  const byName = classifyByFilename(fileName, [...STANDARD_FOLDERS, ...DILIGENCE_PATHS])
  if (byName?.folderName) return { folder: byName.folderName, reason: byName.reason }

  return {
    folder: UNSORTED_FOLDER,
    reason: leaf ? `no rule for folder "${leaf.trim()}"` : 'loose in the record root',
  }
}

async function planRecord(record: Record_, destRootId: string): Promise<Move[]> {
  // maxDepth is generous: Helper nests seven levels and the whole point is that
  // nothing is left behind in a subfolder nobody thought to look in.
  const files = await listFolder(record.linked, { maxDepth: 8 })
  const moves: Move[] = []

  for (const file of files) {
    // `path` is ALREADY the folder holding the file, with no filename on the
    // end — stripping a segment here looked right and would have consulted the
    // grandparent folder's name for every single file.
    const relativeFolder = file.path ?? ''
    if (!file.parentId) continue
    const { folder, reason } = destinationFor(file.name, relativeFolder)
    moves.push({
      fileId: file.id,
      fileName: file.name,
      fromParentId: file.parentId,
      fromPath: relativeFolder ? `${relativeFolder}/${file.name}` : file.name,
      toFolderId: null,
      toPath: `${PROJECTS_SHELF}/${driveFolderName(record.name)}/${folder}`,
      reason,
    })
  }

  // Resolve destination folder ids once per distinct destination, not per file.
  const byFolder = new Map<string, Move[]>()
  for (const m of moves) {
    const key = m.toPath.split('/').slice(2).join('/')
    const list = byFolder.get(key) ?? []
    list.push(m)
    byFolder.set(key, list)
  }
  for (const [candidate, list] of byFolder) {
    if (!APPLY) continue
    const folder = await ensureFolderPath(candidate, destRootId)
    for (const m of list) m.toFolderId = folder.id
  }

  return moves
}

async function main(): Promise<void> {
  if (!isGoogleConfigured()) {
    console.error('Google Workspace is not configured — nothing to do.')
    process.exit(1)
  }
  if (APPLY) await assertFullDriveScope()

  console.log(`\n${B}=== Drive migration ===${O}`)
  console.log(APPLY ? `${G}APPLY${O} — files will be moved\n` : `${Y}DRY RUN${O} — nothing will be moved (pass --apply)\n`)

  // Destination folders were made by setup-drive-structure.mts.
  const shelves = await listSubfolders(HQ_FOLDER_ID, { orderBy: 'name' })
  const projectsShelf = shelves.find((s) => s.name === PROJECTS_SHELF)
  if (!projectsShelf) {
    console.error(`${R}${PROJECTS_SHELF} does not exist. Run setup-drive-structure.mts --apply first.${O}`)
    process.exit(1)
  }
  const destFolders = await listSubfolders(projectsShelf.id, { orderBy: 'name' })

  const records = await loadRecords()
  const manifest: string[] = ['record\tfrom\tto\treason']
  let planned = 0
  let moved = 0
  let failed = 0
  let alreadyThere = 0

  for (const record of records) {
    const destName = driveFolderName(record.name)
    const dest = destFolders.find((f) => f.name === destName)
    if (!dest) {
      console.log(`  ${Y}skip${O}  ${record.name} ${D}— no ${PROJECTS_SHELF}/${destName} folder${O}`)
      continue
    }
    // Already migrated: the link points inside the new shelf.
    if (record.linked === dest.id) {
      alreadyThere++
      continue
    }

    const moves = await planRecord(record, dest.id)
    console.log(`\n${B}${record.name}${O} ${D}(${moves.length} files)${O}`)
    // Per record, not global: a failure on one deal must not stop the next deal
    // being re-pointed, and a global counter would make every record after the
    // first failure silently keep its old link.
    let recordFailed = 0

    for (const m of moves) {
      planned++
      manifest.push(`${record.name}\t${m.fromPath}\t${m.toPath}\t${m.reason}`)
      const label = `${m.fromPath}  ${D}→${O}  ${m.toPath.split('/').slice(2).join('/')}`
      if (!APPLY) {
        console.log(`  ${Y}plan${O}  ${label} ${D}(${m.reason})${O}`)
        continue
      }
      if (!m.toFolderId) {
        console.log(`  ${R}fail${O}  ${label} — destination unresolved`)
        failed++; recordFailed++
        continue
      }
      try {
        await moveFile(m.fileId, m.fromParentId, m.toFolderId)
        console.log(`  ${G}move${O}  ${label}`)
        moved++
      } catch (err) {
        console.log(`  ${R}fail${O}  ${label} — ${err instanceof Error ? err.message : err}`)
        failed++; recordFailed++
      }
    }

    // Re-point the record and leave a signpost. Only once every file moved:
    // a record pointing at the new folder while files remain in the old one is
    // the worst of both, and silently so.
    if (APPLY && recordFailed === 0 && moves.length > 0) {
      const supabase = createAdminClient()
      await supabase
        .from(record.kind === 'project' ? 'projects' : 'opportunities')
        .update({ drive_source_folder_id: dest.id })
        .eq('id', record.id)
      await renameFile(record.linked, `${await folderDisplayName(record.linked)} (moved — see ${PROJECTS_SHELF}/${destName})`)
    }
  }

  writeFileSync(MANIFEST_PATH, manifest.join('\n') + '\n', 'utf8')

  console.log(
    `\n${B}planned: ${planned}  moved: ${moved}  failed: ${failed}  records already migrated: ${alreadyThere}${O}`
  )
  console.log(`${D}manifest: ${MANIFEST_PATH}${O}`)
  if (!APPLY) console.log(`${Y}Dry run — review the manifest, then re-run with --apply.${O}`)
  console.log()
}

/** The folder's current name, so the signpost rename keeps it. */
async function folderDisplayName(folderId: string): Promise<string> {
  const { getFolderName } = await import('@/lib/integrations/google-drive')
  return (await getFolderName(folderId)) ?? 'Folder'
}

main().catch((err) => {
  console.error('\nFailed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
