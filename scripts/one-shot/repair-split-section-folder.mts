/**
 * Repair the one section folder whose own name contains a slash.
 *
 *   node --no-deprecation --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/one-shot/repair-split-section-folder.mts [--apply]
 *
 * Richard's section 01.6 is named `On-Site / Behind-the-Meter Generation`. The
 * folder builder took a slash-joined path and split it, so every room it built
 * got `01.6 — On-Site ` containing ` Behind-the-Meter Generation` instead of one
 * folder with the real name — 42 rooms: 16 deals and 26 blanks. The cause is
 * fixed (`roomFolderSegments()` hands over segments and nothing splits a name);
 * this clears up what the broken version made.
 *
 * ⚠ IT TRASHES ONLY A FOLDER THIS BUILD CREATED, AND ONLY WHEN IT IS EMPTY.
 * These are minutes-old folders nobody has filed into, so removing them is
 * cleaning up my own mistake rather than touching the team's filing — but that
 * is an assumption and it is CHECKED, not assumed: a folder holding anything at
 * all is left alone and reported, because on a shared drive a sync or a person
 * could have put something there between the build and this run. Trash, never
 * delete: `canDelete` is false on a shared drive anyway, and trash is
 * recoverable for 30 days.
 *
 * Dry run by default.
 */

import {
  ensureFolder,
  folderUrl,
  trashFile,
} from '@/lib/integrations/google-drive-write'
import { listFolder, listSubfolders } from '@/lib/integrations/google-drive'
import { createAdminClient } from '@/lib/supabase/admin'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'
import {
  DRAFTS_FOLDER,
  HQ_FOLDER_ID,
  PROJECTS_SHELF,
  SHARED_DRIVE_ID,
  SUPERSEDED_FOLDER,
  folderName,
  sectionByKey,
} from '@/lib/drive/data-room'

const G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', D = '\x1b[2m', B = '\x1b[1m', O = '\x1b[0m'
const APPLY = process.argv.includes('--apply')

const section = sectionByKey('01.6')
if (!section) throw new Error('01.6 is not in the template')
const PARENT = folderName(sectionByKey('01')!)
const CORRECT = folderName(section)
/** What the split produced: the name up to the slash, trailing space and all. */
const BROKEN_PREFIX = CORRECT.split('/')[0]

if (!isGoogleConfigured()) throw new Error('Google Workspace is not configured.')

console.log(`\n${B}=== Repair "${CORRECT}" ===${O}`)
console.log(APPLY ? `${G}APPLY${O}\n` : `${Y}DRY RUN${O} — nothing will change (pass --apply)\n`)
console.log(`  ${D}correct:  "${CORRECT}"${O}`)
console.log(`  ${D}broken:   "${BROKEN_PREFIX}" containing the remainder${O}\n`)

const shelf = (await listSubfolders(HQ_FOLDER_ID, { driveId: SHARED_DRIVE_ID })).find(
  (f) => f.name.trim() === PROJECTS_SHELF
)
if (!shelf) throw new Error(`${PROJECTS_SHELF} not found`)

/**
 * Every room — the shelf walk PLUS every folder a record points at.
 *
 * ⚠ THE SHELF WALK ALONE MISSES THE ROOMS THAT ARE NOT ON THE SHELF, and this
 * drive has five of them: Myton Development under `General Contracting / Build
 * Projects / USA | Canada / Utah`, West Wendover at a great-grandchild of the
 * shelf, Alaska under `Ber Earth`. A walk bounded at two levels found 39 of the
 * rooms this build touched and would have left the rest broken. The DATABASE is
 * the authoritative list of where a record's documents live, so it is read too
 * and the two are merged by folder id.
 */
const rooms: Array<{ id: string; name: string }> = []
const seen = new Set<string>()
const add = (id: string, name: string) => {
  if (seen.has(id)) return
  seen.add(id)
  rooms.push({ id, name })
}

for (const child of await listSubfolders(shelf.id, { driveId: SHARED_DRIVE_ID })) {
  add(child.id, child.name.trim())
  const inner = await listSubfolders(child.id, { driveId: SHARED_DRIVE_ID })
  // A grouping folder holds project folders rather than the filing scheme.
  if (inner.length >= 3 && !inner.some((f) => /^0[012] — /.test(f.name.trim()))) {
    for (const g of inner) add(g.id, `${child.name.trim()}/${g.name.trim()}`)
  }
}

const supabase = createAdminClient()
for (const table of ['projects', 'opportunities'] as const) {
  const { data, error } = await supabase
    .from(table)
    .select('name, drive_source_folder_id')
    .eq('data_room_template', 'data_center')
  if (error) throw new Error(`${table}: ${error.message}`)
  for (const row of data ?? []) {
    if (row.drive_source_folder_id) add(row.drive_source_folder_id, row.name ?? table)
  }
}

const tally = { repaired: 0, alreadyRight: 0, notAffected: 0, held: 0, failed: 0 }

for (const room of rooms) {
  const top = await listSubfolders(room.id, { driveId: SHARED_DRIVE_ID })
  const power = top.find((f) => f.name.trim() === PARENT)
  if (!power) {
    tally.notAffected++
    continue
  }

  const subs = await listSubfolders(power.id, { driveId: SHARED_DRIVE_ID })
  // Compared untrimmed: the broken folder's name ends in a space, and that
  // space is the evidence it came from a split rather than from a person.
  const broken = subs.find((f) => f.name === BROKEN_PREFIX || f.name.trim() === BROKEN_PREFIX.trim())
  const correct = subs.find((f) => f.name === CORRECT)

  if (!broken && correct) {
    tally.alreadyRight++
    continue
  }
  if (!broken && !correct) {
    tally.notAffected++
    continue
  }

  // ⚠ Anything inside at all — at any depth — and it is left alone.
  let contents: Awaited<ReturnType<typeof listFolder>> = []
  try {
    contents = await listFolder(broken!.id, { maxDepth: 4, includeArchived: true })
  } catch (err) {
    console.log(`  ${R}unreadable${O} ${room.name}: ${err instanceof Error ? err.message : err}`)
    tally.failed++
    continue
  }
  if (contents.length) {
    console.log(
      `  ${Y}held${O}  ${room.name} ${D}— "${broken!.name}" holds ${contents.length} file(s),` +
        ` left alone: ${folderUrl(broken!.id)}${O}`
    )
    tally.held++
    continue
  }

  if (!APPLY) {
    console.log(`  ${G}fix${O}   ${room.name}`)
    tally.repaired++
    continue
  }

  try {
    // The right folder first, so the room is never without an 01.6.
    const made = await ensureFolder(CORRECT, power.id)
    await ensureFolder(DRAFTS_FOLDER, made.id)
    await ensureFolder(SUPERSEDED_FOLDER, made.id)
    // Then the split pair, child first — trashing a parent trashes its child,
    // but doing it explicitly means a partial failure leaves nothing orphaned.
    for (const inner of await listSubfolders(broken!.id, { driveId: SHARED_DRIVE_ID })) {
      await trashFile(inner.id)
    }
    await trashFile(broken!.id)
    console.log(`  ${G}fixed${O} ${room.name}`)
    tally.repaired++
  } catch (err) {
    console.log(`  ${R}failed${O} ${room.name}: ${err instanceof Error ? err.message : err}`)
    tally.failed++
  }
}

console.log(`\n${B}Totals${O}`)
console.log(`  rooms examined        ${rooms.length}`)
console.log(`  ${APPLY ? 'repaired' : 'to repair'}             ${tally.repaired}`)
console.log(`  already correct       ${tally.alreadyRight}`)
console.log(`  no 01.6 folder        ${tally.notAffected}`)
if (tally.held) console.log(`  ${Y}held — not empty      ${tally.held}${O}`)
if (tally.failed) console.log(`  ${R}failed                ${tally.failed}${O}`)
