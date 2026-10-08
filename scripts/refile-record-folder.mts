/**
 * Re-file a record's already-copied data room using the current rules.
 *
 *   node --no-deprecation --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/refile-record-folder.mts --record "<name>" --source <roomId> [--apply]
 *
 * WHY THIS EXISTS. `copy-data-room.mts` decides a destination AT COPY TIME, so a
 * room copied before a classification fix stays filed the way the old rules saw
 * it — and that is not a small difference: Weirton copied at 7% classified
 * (170 of 183 in `_Unsorted`) and the fixed rules put the same files at ~98%.
 * Re-copying is not the answer, because the dedupe is on `md5Checksum` and
 * correctly refuses to copy bytes we already hold.
 *
 * ⚠ IT MOVES, IT NEVER COPIES OR DELETES, and it only ever touches files inside
 * the RECORD's own folder — never the counterparty's room, which is theirs.
 *
 * ⚠ MATCHING IS BY NAME, WHICH IS ONLY SAFE BECAUSE OF THE REFUSAL BELOW. A
 * file name is not evidence of sameness (§12, 09-25 — four title commitments
 * shared one name), so a name appearing more than once in the room, or more
 * than once in the record folder, is SKIPPED and counted rather than guessed at.
 * The copy already happened; a wrong move here is a document filed under the
 * wrong lane, which is the thing this pass exists to fix.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { listFolder, listSubfolders } from '@/lib/integrations/google-drive'
import { moveFile } from '@/lib/integrations/google-drive-write'
import { ensureFolderPath } from '@/lib/drive/file-document'
import {
  classifyBySourceFolder, classifyByFilename,
  STANDARD_FOLDERS, DILIGENCE_PATHS, UNSORTED_FOLDER,
} from '@/lib/drive/classify'

const G = '\x1b[32m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', O = '\x1b[0m'
const APPLY = process.argv.includes('--apply')
const arg = (f: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] ?? null : null }
const RECORD = arg('--record')
const SOURCE = arg('--source')
if (!RECORD || !SOURCE) { console.error('need --record "<name>" and --source <roomFolderId>'); process.exit(1) }

const candidates = [...STANDARD_FOLDERS, ...DILIGENCE_PATHS]
const db = createAdminClient()
const { data: proj, error } = await db.from('projects')
  .select('id, name, drive_source_folder_id').eq('name', RECORD).single()
if (error || !proj?.drive_source_folder_id) throw new Error(`no linked folder for "${RECORD}": ${error?.message}`)
const ROOT = proj.drive_source_folder_id

// Where each name BELONGS, from the counterparty's own folder structure.
const room = await listFolder(SOURCE, { maxDepth: 6 })
const wanted = new Map<string, string>()
const dupInRoom = new Set<string>()
for (const f of room) {
  const rel = f.path ? `${f.path}` : ''
  const choice = classifyBySourceFolder(rel, candidates) ?? classifyByFilename(f.name, candidates)
  const dest = choice?.folderName ?? UNSORTED_FOLDER
  if (wanted.has(f.name) && wanted.get(f.name) !== dest) dupInRoom.add(f.name)
  wanted.set(f.name, dest)
}

// Where each name IS, inside the record's own folder.
const subs = await listSubfolders(ROOT, { orderBy: 'name' })
const located = new Map<string, { id: string; parentId: string; parentName: string }>()
const dupInRecord = new Set<string>()
for (const s of subs) {
  for (const f of await listFolder(s.id, { maxDepth: 4 })) {
    if (located.has(f.name)) dupInRecord.add(f.name)
    located.set(f.name, { id: f.id, parentId: f.parentId ?? s.id, parentName: s.name })
  }
}

const ensured = new Map<string, string>()
async function folderIdFor(candidate: string): Promise<string> {
  const have = ensured.get(candidate)
  if (have) return have
  const { id } = await ensureFolderPath(candidate, ROOT)
  ensured.set(candidate, id)
  return id
}

let moved = 0, correct = 0, skipped = 0, unknown = 0
for (const [name, dest] of wanted) {
  const at = located.get(name)
  if (!at) { unknown++; continue }                        // never copied (over the size ceiling, or not a document)
  if (dupInRoom.has(name) || dupInRecord.has(name)) {
    skipped++
    console.log(`  ${Y}skip${O}  ${name} ${D}(the name appears more than once — not moving on a name alone)${O}`)
    continue
  }
  const leaf = dest.split('/').pop()!
  if (at.parentName.trim() === leaf.trim()) { correct++; continue }
  moved++
  console.log(`  ${APPLY ? G + 'move' : 'plan'}${O}  ${name}\n          ${at.parentName.trim()} ${D}→${O} ${dest}`)
  if (!APPLY) continue
  await moveFile(at.id, at.parentId, await folderIdFor(dest))
}

console.log(`\n${B}${RECORD}${O}`)
console.log(`  already right: ${correct}   to move: ${moved}   skipped (ambiguous name): ${skipped}   in the room but not copied: ${unknown}`)
if (!APPLY) console.log(`${Y}Dry run — re-run with --apply.${O}`)
