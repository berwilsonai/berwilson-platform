/**
 * What is actually in `02 Projects`, and which record each folder belongs to.
 *
 *   node --no-deprecation --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/audit-project-rooms.mts [--sheet]
 *
 * ⚠ READ-ONLY. It lists folders, counts files and reads permissions. It never
 * moves, renames, links or trashes anything. `--sheet` is the one thing it
 * writes, and it writes it to a NEW file of its own in `02 Projects` so the
 * answer is readable on a phone.
 *
 * WHY THIS EXISTS. Building a uniform data room per deal assumes one folder per
 * deal, and that assumption was wrong. Measured 2026-10-29: `02 Projects` holds
 * 27 children, one of which — `Data Center & Power Developments` — holds a
 * further 18 project folders, so rooms exist at two depths and seven records
 * point at the deeper one. The consequences are not cosmetic:
 *
 *   - `Data Center & Power Developments/Steelton - Pennsylvania` holds 53 files
 *     and NO record points at it, while the record points at a different
 *     Steelton folder holding 194. Those 53 have never been imported, never
 *     indexed, and are invisible to Ber AI.
 *   - `Cleveland Cliffs - New Richmond Ohio` holds 30 files and has no record
 *     at all. Five more orphans hold 11 between them.
 *   - Several duplicates are empty shells (`02 Projects/Tooele` has 0 files
 *     while the linked `TEAD - Forge 42` folder has 1), which is harmless and
 *     worth telling apart from the two above.
 *
 * ⚠ IT REPORTS AND MERGES NOTHING, and that is the design, not laziness. The
 * platform refuses to match a folder to a record by name on purpose —
 * "Myton - Utah" has two candidate projects, so does "Stockton, Utah", and West
 * Wendover appears in two separate trees (`project-folder-sync.ts`). A confident
 * misfile is worse than an unlinked folder, which at least announces itself. So
 * a suspected duplicate is printed with its score and its file count for a
 * human to rule on, exactly as `/api/drive/suggest` does.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  folderAncestry,
  listFolder,
  listSubfolders,
  type DriveFile,
} from '@/lib/integrations/google-drive'
import {
  externalGrants,
  listGrants,
  upsertSheetFromCsv,
  folderUrl,
} from '@/lib/integrations/google-drive-write'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { HQ_FOLDER_ID, PROJECTS_SHELF, SHARED_DRIVE_ID } from '@/lib/drive/data-room'
import { isStandardSet } from '@/lib/drive/file-document'
import { tokenize } from '@/lib/email-sweep/cluster-phase'
import { overlapCoefficient } from '@/lib/utils/similarity'
import { csvDocument } from '@/lib/utils/csv'

const G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', D = '\x1b[2m', B = '\x1b[1m', O = '\x1b[0m'

const WRITE_SHEET = process.argv.includes('--sheet')

/** ⚠ Ids chunked well under PostgREST's URL cap — §12: 1000 uuids is a 37KB GET
 *  and Kong answers `URI too long`, which reads exactly like "no records". */
const ID_CHUNK = 150

interface RecordRef {
  id: string
  name: string
  kind: 'project' | 'opportunity'
  template: string
  linked: string | null
}

interface Room {
  id: string
  name: string
  /** `02 Projects/<name>` or `02 Projects/<group>/<name>`. */
  path: string
  files: number
  newest: string | null
  /** How many of its files the platform already holds a row for. */
  held: number
  record: RecordRef | null
  /** Set when nothing points here but a linked room's record fits the name. */
  suspectedDuplicateOf: { name: string; score: number; files: number } | null
  external: string[]
  /** Ids of this folder's own subfolders, for the ancestry test below. */
  childIds: string[]
  verdict: string
}

async function loadRecords(): Promise<RecordRef[]> {
  const supabase = createAdminClient()
  const out: RecordRef[] = []

  const { data: projects, error: pErr } = await supabase
    .from('projects')
    .select('id, name, drive_source_folder_id, data_room_template')
    .order('name')
  if (pErr) throw new Error(`projects: ${pErr.message}`)
  for (const p of projects ?? []) {
    if (!p.name?.trim()) continue
    out.push({
      id: p.id,
      name: p.name,
      kind: 'project',
      template: p.data_room_template,
      linked: p.drive_source_folder_id,
    })
  }

  const { data: opps, error: oErr } = await supabase
    .from('opportunities')
    .select('id, name, drive_source_folder_id, data_room_template')
    .order('name')
  if (oErr) throw new Error(`opportunities: ${oErr.message}`)
  for (const o of opps ?? []) {
    if (!o.name?.trim()) continue
    out.push({
      id: o.id,
      name: o.name,
      kind: 'opportunity',
      template: o.data_room_template,
      linked: o.drive_source_folder_id,
    })
  }

  return out
}

/**
 * Which of these Drive file ids the platform already holds a document row for.
 *
 * ⚠ BOTH TABLES. `documents.drive_file_id` is uniquely indexed platform-wide
 * and `opportunity_documents` carries the same column under its own index, so
 * asking only the first reports every opportunity's room as un-imported (§9's
 * two-table split; the same read was added to the knowledge sync for this
 * reason).
 */
async function heldFileIds(fileIds: string[]): Promise<Set<string>> {
  const supabase = createAdminClient()
  const held = new Set<string>()
  for (let i = 0; i < fileIds.length; i += ID_CHUNK) {
    const chunk = fileIds.slice(i, i + ID_CHUNK)
    for (const table of ['documents', 'opportunity_documents'] as const) {
      const { data, error } = await supabase
        .from(table)
        .select('drive_file_id')
        .in('drive_file_id', chunk)
      // ⚠ A failed read must never be reported as "the platform holds none of
      // these" — that is the number this whole audit turns on.
      if (error) throw new Error(`${table}: ${error.message}`)
      for (const row of data ?? []) if (row.drive_file_id) held.add(row.drive_file_id)
    }
  }
  return held
}

/** Children of a folder on the shared drive. `driveId` is not optional here. */
async function children(folderId: string): Promise<DriveFile[]> {
  return listSubfolders(folderId, { driveId: SHARED_DRIVE_ID })
}

async function main(): Promise<void> {
  if (!isGoogleConfigured()) throw new Error('Google Workspace is not configured.')

  const records = await loadRecords()
  const byFolder = new Map<string, RecordRef>()
  for (const r of records) if (r.linked) byFolder.set(r.linked, r)

  console.log(`\n${B}Reading ${PROJECTS_SHELF}…${O}`)
  const shelf = (await children(HQ_FOLDER_ID)).find((f) => f.name.trim() === PROJECTS_SHELF)
  if (!shelf) throw new Error(`${PROJECTS_SHELF} not found under the HQ folder.`)

  /**
   * A child of the shelf is a ROOM unless it is a grouping folder.
   *
   * The test is what its own children look like: a room's children are the
   * filing scheme (`isStandardSet`), a grouping folder's children are project
   * names. Measured rather than guessed — `Data Center & Power Developments` is
   * the only grouping folder on this drive and it holds 18 project folders, so
   * three or more non-scheme children is the distinguishing shape.
   */
  const rooms: Array<{ folder: DriveFile; path: string }> = []
  for (const child of await children(shelf.id)) {
    const subs = await children(child.id)
    const names = subs.map((s) => s.name.trim())
    const grouping = subs.length >= 3 && !isStandardSet(names)
    if (!grouping) {
      rooms.push({ folder: child, path: `${PROJECTS_SHELF}/${child.name.trim()}` })
      continue
    }
    console.log(`  ${Y}group${O} ${child.name.trim()} ${D}— ${subs.length} rooms inside${O}`)
    for (const inner of subs) {
      rooms.push({
        folder: inner,
        path: `${PROJECTS_SHELF}/${child.name.trim()}/${inner.name.trim()}`,
      })
    }
  }

  console.log(`  ${D}${rooms.length} candidate rooms${O}\n`)

  const out: Room[] = []
  for (const { folder, path } of rooms) {
    // maxDepth 4 covers `<room>/01 — …/01.5 — …/Drafts/<file>`; the template is
    // three folders deep once the status subfolders exist.
    let files: DriveFile[] = []
    let listed = true
    try {
      files = await listFolder(folder.id, { maxDepth: 4, includeArchived: true })
    } catch (err) {
      listed = false
      console.error(`  ${R}unreadable${O} ${path}: ${err instanceof Error ? err.message : err}`)
    }
    const held = listed ? await heldFileIds(files.map((f) => f.id)) : new Set<string>()
    const grants = await listGrants(folder.id)
    const record = byFolder.get(folder.id) ?? null
    const childIds = listed ? (await children(folder.id)).map((c) => c.id) : []

    out.push({
      id: folder.id,
      name: folder.name.trim(),
      path,
      files: files.length,
      newest: files.map((f) => f.modifiedTime).filter(Boolean).sort().pop() ?? null,
      held: held.size,
      record,
      suspectedDuplicateOf: null,
      external: externalGrants(grants).map((g) => `${g.who ?? g.type} (${g.role})`),
      childIds,
      verdict: !listed ? 'unreadable' : record ? 'linked' : 'UNCLAIMED',
    })
  }

  /**
   * ⚠ A ROOM THAT CONTAINS A LINKED FOLDER IS A SHELF, NOT AN ORPHAN.
   *
   * Found by this audit disagreeing with itself: `West Wendover - Trump City
   * Initiative` was reported an orphan holding 28 files of which the platform
   * already held 27 — which cannot be true of a folder nothing points at. The
   * record points at `Trump City (WW NV)`, a CHILD of it, so the parent is a
   * shelf and its files are the child's. A verdict that argues with the number
   * printed beside it is the verdict that is wrong (§12).
   */
  const linkedIds = new Set(records.map((r) => r.linked).filter(Boolean) as string[])
  for (const room of out) {
    if (room.record || room.verdict === 'unreadable') continue
    const held = room.childIds.filter((id) => linkedIds.has(id))
    if (held.length) {
      // From `byFolder`, not from `out`: the linked folder is a CHILD of this
      // room and so is one level below the walk, which printed an empty list.
      const inside = held.map((id) => byFolder.get(id)?.name ?? id)
      room.verdict = 'shelf — holds a linked room'
      room.suspectedDuplicateOf = null
      console.log(
        `  ${D}shelf ${room.name} holds ${held.length} linked room(s): ${inside.join(', ')}${O}`
      )
    }
  }

  /**
   * For every unclaimed room, is there a linked room whose record fits its name?
   *
   * ⚠ A SUGGESTION, NEVER A CONCLUSION. `overlapCoefficient` scores a short name
   * 1.0 against every longer one containing it, which is right for ranking
   * something a person is about to choose and wrong for anything that files.
   * The file counts beside it are what actually answer "which is the real room".
   *
   * ⚠ AND IT IS SCORED ON DISTINCTIVE TOKENS ONLY, which this audit's first run
   * proved necessary: `Cleveland Cliffs - Whisky - Dallas TX` and `Cleveland
   * Cliffs - New Richmond Ohio` were both offered as "possibly Weirton —
   * Cleveland-Cliffs (WV)" at 0.67, because `cleveland` and `cliffs` are a
   * COUNTERPARTY shared by five records and they outvoted the one word that
   * identifies the deal. §12: a shared industry word is the one thing an
   * identifier must not be, and counting matched tokens is not a bar. Tokens
   * appearing in more than two record names are dropped, so a room with nothing
   * distinctive left gets no suggestion at all — which is the honest answer and
   * is what both of those rooms now get (`Whisky` is not `Whiskey`, and no
   * score should paper over a spelling nobody has reconciled).
   */
  const df = new Map<string, number>()
  for (const r of records) {
    for (const t of new Set(tokenize(r.name))) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const DF_MAX = 2
  const distinctive = (text: string) =>
    new Set([...tokenize(text)].filter((t) => (df.get(t) ?? 0) <= DF_MAX))

  const linked = out.filter((r) => r.record)
  for (const room of out) {
    if (room.record || room.verdict !== 'UNCLAIMED') continue
    const roomTokens = distinctive(room.name)
    let best: Room | null = null
    let bestScore = 0
    for (const other of linked) {
      const score = Math.max(
        overlapCoefficient(roomTokens, distinctive(other.record!.name)),
        overlapCoefficient(roomTokens, distinctive(other.name))
      )
      if (score > bestScore) {
        bestScore = score
        best = other
      }
    }
    if (best && bestScore >= 0.6) {
      room.suspectedDuplicateOf = {
        name: best.record!.name,
        score: Number(bestScore.toFixed(2)),
        files: best.files,
      }
      room.verdict = room.files === 0 ? 'empty duplicate' : 'DUPLICATE WITH FILES'
    } else {
      room.verdict = room.files === 0 ? 'empty, no record' : 'ORPHAN WITH FILES'
    }
  }

  // ── The report ─────────────────────────────────────────────────────────────
  const rank: Record<string, number> = {
    'DUPLICATE WITH FILES': 0,
    'ORPHAN WITH FILES': 1,
    unreadable: 2,
    linked: 3,
    'shelf — holds a linked room': 4,
    'empty duplicate': 5,
    'empty, no record': 6,
  }
  out.sort((a, b) => (rank[a.verdict] ?? 9) - (rank[b.verdict] ?? 9) || b.files - a.files)

  /**
   * ⚠ THE PATH IS NEVER TRUNCATED, and that is not a formatting preference.
   * Padding it to a column width hid the folder NAME on every row that
   * mattered — the two rooms shared with outside writers both read as
   * `02 Projects/Data Center & Power Developments/…`, so the report named a
   * problem and withheld which deal it was about. §12: a script reading a
   * truncated set is worse than none, because it is believed.
   */
  for (const r of out) {
    const colour =
      r.verdict.startsWith('DUPLICATE') || r.verdict.startsWith('ORPHAN')
        ? R
        : r.verdict === 'linked'
          ? G
          : D
    const gap = r.files - r.held
    const held = gap > 0 ? `${r.held} of ${r.files}` : String(r.files)
    console.log(`\n${colour}${B}${r.verdict}${O}  ${r.path}`)
    console.log(`  ${D}files ${r.files} · platform holds ${held}${O}`)
    if (r.record) console.log(`  ${D}record:${O} ${r.record.name} ${D}(${r.record.kind})${O}`)
    if (r.suspectedDuplicateOf) {
      console.log(
        `  ${D}possibly the same deal as${O} ${r.suspectedDuplicateOf.name}` +
          ` ${D}(score ${r.suspectedDuplicateOf.score},` +
          ` ${r.suspectedDuplicateOf.files} files in that room)${O}`
      )
    }
    if (r.external.length) {
      console.log(`  ${R}${B}EXTERNAL ACCESS${O} ${Y}${r.external.join(', ')}${O}`)
    }
  }

  /**
   * ⚠ FILES NOT HELD, NOT FILES PRESENT, and only in genuinely unclaimed rooms.
   * Summing every file in every unclaimed room read 185 while the real figure
   * was 157: it was counting the 28 under the West Wendover shelf, which the
   * platform already holds through the child the record points at. "Invisible
   * to Ber AI" has one definition — no document row — and the number has to be
   * computed from that definition rather than from a near-enough proxy (§12).
   */
  const unclaimed = out.filter(
    (r) => r.verdict === 'ORPHAN WITH FILES' || r.verdict === 'DUPLICATE WITH FILES'
  )
  const invisible = unclaimed.reduce((n, r) => n + (r.files - r.held), 0)
  const unheld = out.filter((r) => r.record).reduce((n, r) => n + (r.files - r.held), 0)

  console.log(`\n${B}Totals${O}`)
  console.log(`  rooms                          ${out.length}`)
  console.log(`  linked to a record             ${out.filter((r) => r.record).length}`)
  console.log(
    `  ${R}files in unclaimed rooms       ${invisible}${O}` +
      ` ${D}— no document row, so invisible to Ber AI (${unclaimed.length} rooms)${O}`
  )
  console.log(`  ${Y}files in linked rooms not held ${unheld}${O} ${D}— a sync away, or unreadable${O}`)
  console.log(
    `  records with no folder        ${records.filter((r) => !r.linked).length} of ${records.length}`
  )

  // Records whose folder is linked but absent from this shelf entirely.
  const roomIds = new Set(out.map((r) => r.id))
  const elsewhere = records.filter((r) => r.linked && !roomIds.has(r.linked))
  if (elsewhere.length) {
    console.log(`\n${Y}Linked to a folder OUTSIDE ${PROJECTS_SHELF}:${O}`)
    for (const r of elsewhere) {
      const chain = await folderAncestry(r.linked!)
      console.log(`  ${B}${r.name}${O} ${D}(${r.kind})${O}`)
      console.log(`    ${D}${chain.join(' / ') || 'could not read the chain'}${O}`)
      console.log(`    ${D}${folderUrl(r.linked!)}${O}`)
    }
    console.log(
      `\n  ${Y}⚠ So project folders live in at least three places, not one.${O}` +
        ` ${D}A uniform room per deal is only uniform once they agree.${O}`
    )
  }

  if (!WRITE_SHEET) {
    console.log(`\n${D}Pass --sheet to publish this into ${PROJECTS_SHELF} as a spreadsheet.${O}`)
    return
  }

  const csv = csvDocument(
    ['Verdict', 'Files', 'Held by platform', 'Room', 'Record', 'Suspected duplicate of',
     'Score', 'Files in that room', 'External access', 'Newest file', 'Folder'],
    out.map((r) => [
      r.verdict,
      r.files,
      r.held,
      r.path,
      r.record?.name ?? '',
      r.suspectedDuplicateOf?.name ?? '',
      r.suspectedDuplicateOf?.score ?? '',
      r.suspectedDuplicateOf?.files ?? '',
      r.external.join('; '),
      r.newest?.slice(0, 10) ?? '',
      folderUrl(r.id),
    ])
  )
  const { ref, created } = await upsertSheetFromCsv({
    folderId: shelf.id,
    name: 'Project rooms — audit (platform)',
    csv,
  })
  console.log(`\n${G}${created ? 'created' : 'refreshed'}${O} ${ref.webViewLink ?? ref.id}`)
}

main().catch((err) => {
  console.error(`\n${R}failed${O}`, err instanceof Error ? err.message : err)
  process.exit(1)
})
