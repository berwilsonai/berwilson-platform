/**
 * Record WHICH nominated Drive folder each company document came from.
 *
 * The knowledge sync had `file.path` in hand all along — it passes it to the
 * arrivals notification — and simply dropped it from the row. So the company
 * knowledge list was 142 undifferentiated cards with no origin, while the
 * project importer had been recording the same column since September.
 *
 * Without this there is no way to answer "which shelf is leaking deal
 * material", which is the question that decides whether a folder should stay
 * nominated at all. Nominating folders IS the control model.
 *
 * Costs one Drive listing per nominated folder. No downloads, no model calls,
 * no writes to anything but drive_folder_path. Safe to re-run.
 *
 * Pass --dry to see what it would set without writing.
 */
import { createAdminClient } from '../src/lib/supabase/admin.ts'
import {
  listFolder,
  getFolderName,
  driveKnowledgeFolderIds,
} from '../src/lib/integrations/google-drive.ts'

const dry = process.argv.includes('--dry')
const supabase = createAdminClient()

const folderIds = driveKnowledgeFolderIds()
if (folderIds.length === 0) {
  console.error('No GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID configured — nothing to backfill.')
  process.exit(1)
}

// Where each drive file lives, by id.
const pathById = new Map<string, string>()
for (const id of folderIds) {
  const shelf = (await getFolderName(id)) ?? id
  let listed = 0
  try {
    for (const f of await listFolder(id, { maxDepth: 4 })) {
      pathById.set(f.id, [shelf, f.path].filter(Boolean).join('/'))
      listed++
    }
  } catch (err) {
    console.error(`  ✗ could not list ${shelf} (${id}):`, err instanceof Error ? err.message : err)
    continue
  }
  console.log(`  ${shelf} — ${listed} files`)
}
console.log(`\n${pathById.size} files across ${folderIds.length} nominated folders.\n`)

const { data, error } = await supabase
  .from('documents')
  .select('id, file_name, drive_file_id, drive_folder_path')
  .eq('is_company', true)
  .not('drive_file_id', 'is', null)
if (error) {
  // A zero from a broken query and a zero from an empty table are the same
  // number on screen (§12) — refuse rather than report success.
  console.error('Could not read company documents:', error.message)
  process.exit(1)
}

const rows = data ?? []
let updated = 0
const reasons: Record<string, number> = {}
const note = (r: string) => { reasons[r] = (reasons[r] ?? 0) + 1 }

for (const row of rows) {
  const path = pathById.get(row.drive_file_id!)
  if (!path) {
    // In the knowledge base but no longer in any nominated folder — the sync's
    // own reconcile handles retiring those; this script does not judge them.
    note('not in any nominated folder now')
    continue
  }
  if (row.drive_folder_path === path) {
    note('already correct')
    continue
  }
  if (dry) {
    console.log(`  would set ${path}  ←  ${row.file_name.slice(0, 56)}`)
    note('would update')
    continue
  }
  const { error: upErr } = await supabase
    .from('documents')
    .update({ drive_folder_path: path })
    .eq('id', row.id)
  if (upErr) {
    console.error(`  ✗ ${row.file_name}: ${upErr.message}`)
    note('write failed')
    continue
  }
  updated++
}

console.log(`\n${rows.length} company documents from Drive; ${updated} updated${dry ? ' (dry run — nothing written)' : ''}.`)
// Count the REASON beside the number, or the number only says something happened.
for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${r}`)
}
