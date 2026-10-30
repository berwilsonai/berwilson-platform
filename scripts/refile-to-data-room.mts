/**
 * Fold a record's existing Drive folder into Richard's data-room template.
 *
 *   node --no-deprecation --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/refile-to-data-room.mts [--record "<name>"] [--apply]
 *
 * Dry run by default. With no `--record` it covers every record whose
 * `data_room_template` is `data_center` and which has a folder linked.
 *
 * ⚠ IT MOVES, IT NEVER COPIES OR DELETES, and it only ever touches files inside
 * the record's OWN room. Same posture as `refile-record-folder.mts`, for the
 * same reason: the copy already happened, so the worst outcome here is a
 * document on the wrong shelf, which the manifest makes reversible.
 *
 * ⚠ DETERMINISTIC, NO MODEL CALL. ~600 documents at 30–60s per `chooseFolder`
 * is eight hours of a box that serves one request at a time, with every other
 * sweep queued behind it. `foldDecision` in src/lib/drive/data-room.ts decides
 * on the folder a human curated first, then the file name, and parks the rest
 * in `00.0 — _Unsorted` — which is Richard's own instruction (10-29: apply the
 * confident moves, park the uncertain).
 *
 * ⚠ AND IT REWRITES `drive_folder_path` ON THE DOCUMENT ROW IN THE SAME PASS.
 * A Drive move does not change a file id, so `drive_file_id` survives and the
 * importer will not re-import — but `drive_folder_path` is the ONLY thing the
 * platform knows the section from (`sectionOf`), and it goes stale the instant
 * the file moves. Leaving it for a nightly sync would mean the Documents tab
 * and the 00.2 tracker reading yesterday's structure, which is the shape of
 * §12's "orphaned projection looks perfectly live".
 *
 * ⚠ ORDER MATTERS AROUND THE DEPLOY. `next start` loads the build at boot and
 * the hourly drive-watch has already un-retired work mid-session by running
 * against a stale build. Deploy first, then run this.
 */

import { writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'
import { listFolder, listSubfolders, type DriveFile } from '@/lib/integrations/google-drive'
import { ensureFolder, moveFile } from '@/lib/integrations/google-drive-write'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { isPlatformArtifact } from '@/lib/drive/file-document'
import {
  DEFAULT_ROOM_TEMPLATE,
  UNSORTED_SECTION,
  WORKING_FOLDERS,
  sectionOf,
  foldDecision,
  isRoomTemplateKey,
  sectionByKey,
  sectionPath,
} from '@/lib/drive/data-room'

const G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', D = '\x1b[2m', B = '\x1b[1m', O = '\x1b[0m'

const APPLY = process.argv.includes('--apply')
const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}
const ONLY = arg('--record')

/**
 * `--tidy` — report the EMPTY folders the fold leaves behind.
 *
 * The fold moves and never deletes, so a room ends up holding its nineteen
 * sections AND the eleven now-empty folders of the old scheme. On Riverdale
 * that is `Contracts & Legal`, `Land & Title`, `Diligence`, `_Unsorted` and
 * seven more, all empty, sitting beside `01.1 — Site Control & Title`. For a
 * room whose whole purpose is to read as uniform to a partner, that is clutter
 * that undermines the thing the restructure was for.
 *
 * ⚠ IT REPORTS AND TRASHES NOTHING, EVEN WITH `--apply`. These are folders
 * PEOPLE created on the team's own shared drive. Moving files inside a room is
 * what Richard authorised; removing someone else's folder is a different act
 * and a different conversation, and `canDelete` is false on a shared drive
 * anyway so the most that is possible is a trash. The 10-08 restructure's own
 * answer was to KEEP an emptied folder and rename it `… (moved — see …)`, which
 * `isArchiveFolder` already treats as retired — that is the precedent if a
 * gesture is wanted, and it is one command once somebody has read this list.
 */
const TIDY = process.argv.includes('--tidy')
const MANIFEST = arg('--manifest') ?? '/tmp/data-room-manifest.tsv'

interface Target {
  id: string
  name: string
  kind: 'project' | 'opportunity'
  room: string
  docTable: 'documents' | 'opportunity_documents'
  parentCol: 'project_id' | 'opportunity_id'
}

interface Row {
  record: string
  fileId: string
  fileName: string
  from: string
  to: string
  reason: string
  moved: boolean
  error: string
}

async function loadTargets(): Promise<Target[]> {
  const supabase = createAdminClient()
  const out: Target[] = []

  const { data: projects, error: pErr } = await supabase
    .from('projects')
    .select('id, name, drive_source_folder_id, data_room_template, confidential')
    .order('name')
  if (pErr) throw new Error(`projects: ${pErr.message}`)
  for (const p of projects ?? []) {
    const template = isRoomTemplateKey(p.data_room_template)
      ? p.data_room_template
      : DEFAULT_ROOM_TEMPLATE
    if (template !== 'data_center' || !p.drive_source_folder_id || !p.name) continue
    // A confidential project has no shared-drive room by design (§8 — Drive is
    // an outbound channel), so there is nothing here to fold and nothing we
    // should be enumerating about it either.
    if (p.confidential === true) continue
    out.push({
      id: p.id,
      name: p.name,
      kind: 'project',
      room: p.drive_source_folder_id,
      docTable: 'documents',
      parentCol: 'project_id',
    })
  }

  const { data: opps, error: oErr } = await supabase
    .from('opportunities')
    .select('id, name, drive_source_folder_id, data_room_template')
    .order('name')
  if (oErr) throw new Error(`opportunities: ${oErr.message}`)
  for (const o of opps ?? []) {
    const template = isRoomTemplateKey(o.data_room_template)
      ? o.data_room_template
      : DEFAULT_ROOM_TEMPLATE
    if (template !== 'data_center' || !o.drive_source_folder_id || !o.name) continue
    out.push({
      id: o.id,
      name: o.name,
      kind: 'opportunity',
      room: o.drive_source_folder_id,
      docTable: 'opportunity_documents',
      parentCol: 'opportunity_id',
    })
  }

  return ONLY ? out.filter((t) => t.name === ONLY) : out
}

/**
 * The relative PATH a fold target names — a section, or a working folder.
 *
 * ⚠ A TARGET THAT IS NOT A SECTION IS STILL A DESTINATION, and missing that arm
 * cost five documents silently. `FOLDER_TO_SECTION` maps
 * `Master Proposal - Land Development` → `Proposals & Bids`, which is a WORKING
 * folder rather than a section key; the script resolved targets through
 * `sectionByKey` alone, got null, and counted the file as "already placed". It
 * reported success and moved nothing, on a record whose other 99 files moved
 * correctly — the exact §12 shape where a missing arm becomes a silent no-op
 * rather than an error. Returns null only for a target this template does not
 * know at all, which is then a loud failure.
 */
function targetPath(target: string): string | null {
  const section = sectionByKey(target)
  if (section) return sectionPath(section)
  if ((WORKING_FOLDERS as readonly string[]).includes(target)) return target
  return null
}

/** Folder id for a fold target inside one room, created if the build missed it. */
async function targetFolderId(
  target: string,
  roomId: string,
  memo: Map<string, string>
): Promise<string> {
  const key = `${roomId}::${target}`
  const hit = memo.get(key)
  if (hit) return hit

  const path = targetPath(target)
  if (!path) throw new Error(`no such fold target: ${target}`)

  let parent = roomId
  for (const segment of path.split('/')) {
    const made = await ensureFolder(segment, parent)
    parent = made.id
  }
  memo.set(key, parent)
  return parent
}

async function main(): Promise<void> {
  if (!isGoogleConfigured()) throw new Error('Google Workspace is not configured.')

  const targets = await loadTargets()
  if (!targets.length) {
    console.error(ONLY ? `No data-room record named "${ONLY}" with a linked folder.` : 'Nothing to do.')
    process.exit(1)
  }

  console.log(`\n${B}=== Fold into the data room ===${O}`)
  console.log(
    APPLY
      ? `${G}APPLY${O} — files will be moved\n`
      : `${Y}DRY RUN${O} — nothing will be moved (pass --apply)\n`
  )

  const supabase = createAdminClient()
  const rows: Row[] = []
  const bySection = new Map<string, number>()

  for (const target of targets) {
    let files: DriveFile[] = []
    try {
      // Deep enough for `<room>/PQC Giovanni Campus /Utah Land Records /Land
      // Tenure Documents/<file>`, which is the deepest real tree on this drive.
      // `listFolder` skips Archive- and Superseded-named subtrees, so a retired
      // copy is never dragged back into circulation.
      files = await listFolder(target.room, { maxDepth: 6 })
    } catch (err) {
      console.error(`  ${R}unreadable${O} ${target.name}: ${err instanceof Error ? err.message : err}`)
      continue
    }

    const memo = new Map<string, string>()
    let moved = 0
    let left = 0
    let failed = 0

    for (const file of files) {
      if (isPlatformArtifact(file.name, file.mimeType)) {
        left++
        continue
      }

      const decision = foldDecision(file.name, file.path ?? '')
      if (!decision.target) {
        left++
        continue
      }

      // ⚠ A working folder is a destination, not a skip — see `targetPath`.
      // An unknown target is a loud failure rather than a silent no-op.
      const to = targetPath(decision.target)
      if (!to) {
        console.error(`  ${R}unknown target${O} ${decision.target} for ${file.name}`)
        failed++
        continue
      }
      const row: Row = {
        record: target.name,
        fileId: file.id,
        fileName: file.name,
        from: file.path || '(room root)',
        to,
        reason: decision.reason,
        moved: false,
        error: '',
      }

      bySection.set(decision.target, (bySection.get(decision.target) ?? 0) + 1)

      if (APPLY) {
        try {
          const destId = await targetFolderId(decision.target, target.room, memo)
          if (!file.parentId) throw new Error('no current parent reported')
          await moveFile(file.id, file.parentId, destId)

          /**
           * ⚠ THE ROW'S PATH IS REWRITTEN HERE, not left to the nightly sync.
           * Matched on `drive_file_id`, which a move does not change — and on
           * the record too, because a byte-identical document legitimately sits
           * on three sites and `drive_file_id` is unique per table but the
           * document could belong to the sibling table.
           */
          const { error } = await supabase
            .from(target.docTable)
            .update({ drive_folder_path: to })
            .eq('drive_file_id', file.id)
            .eq(target.parentCol, target.id)
          if (error) throw new Error(`row update: ${error.message}`)

          row.moved = true
          moved++
        } catch (err) {
          row.error = err instanceof Error ? err.message : String(err)
          failed++
        }
      } else {
        moved++
      }

      rows.push(row)
    }

    const note = failed ? ` ${R}${failed} failed${O}` : ''
    console.log(
      `  ${B}${target.name}${O} ${D}— ${files.length} files · ${moved} ${APPLY ? 'moved' : 'to move'}` +
        ` · ${left} already placed${O}${note}`
    )
  }

  // ── Where everything landed ────────────────────────────────────────────────
  console.log(`\n${B}By section${O}`)
  for (const [key, n] of [...bySection.entries()].sort()) {
    // A working-folder target has no section to take a label from, and printing
    // a blank beside the count read as a failed render (§12: a bare value at its
    // own weight). Its key IS its name.
    const label = sectionByKey(key)?.label ?? key
    const flag = key === UNSORTED_SECTION ? Y : D
    console.log(`  ${flag}${key.padEnd(6)}${O}${String(n).padStart(4)}  ${label}`)
  }

  const unsorted = bySection.get(UNSORTED_SECTION) ?? 0
  const total = rows.length
  console.log(`\n${B}Totals${O}`)
  console.log(`  ${APPLY ? 'moved' : 'to move'}            ${total}`)
  console.log(
    `  ${unsorted ? Y : D}parked in ${UNSORTED_SECTION}  ${unsorted}${O}` +
      ` ${D}${total ? `(${Math.round((unsorted / total) * 100)}%)` : ''} — nothing placed these, they want a human${O}`
  )
  const failedRows = rows.filter((r) => r.error)
  if (failedRows.length) {
    console.log(`  ${R}failed            ${failedRows.length}${O}`)
    for (const r of failedRows.slice(0, 10)) {
      console.log(`    ${R}${r.fileName}${O} ${D}${r.error}${O}`)
    }
  }

  if (TIDY) {
    console.log(`\n${B}Empty folders left behind${O}`)
    let empties = 0
    for (const target of targets) {
      const stale: string[] = []
      for (const folder of await listSubfolders(target.room)) {
        const name = folder.name.trim()
        // A section, a status folder or a working folder is ours and stays.
        if (sectionOf(name) || WORKING_FOLDERS.includes(name as never)) continue
        if (/^0[012] — /.test(name)) continue
        const inside = await listFolder(folder.id, { maxDepth: 4, includeArchived: true })
        if (inside.length === 0) stale.push(name)
      }
      if (!stale.length) continue
      empties += stale.length
      console.log(`  ${B}${target.name}${O} ${D}— ${stale.length} empty: ${stale.join(', ')}${O}`)
    }
    console.log(
      `\n  ${Y}${empties} empty folders across ${targets.length} rooms.${O}` +
        ` ${D}Nothing was trashed — these are folders people created, and removing one${O}\n` +
        `  ${D}is a decision for Richard. The established gesture is to RENAME an emptied${O}\n` +
        `  ${D}folder "<name> (moved — see 01.x)", which isArchiveFolder already skips.${O}`
    )
  }

  /**
   * ⚠ THE MANIFEST IS WRITTEN ON A DRY RUN TOO, and it is the undo. Every row
   * carries the file id and the folder it came from, so a wrong decision is one
   * reverse move away — which is the only thing that makes "apply the confident
   * moves now" a safe instruction to follow.
   */
  const header = ['record', 'file_id', 'file_name', 'from', 'to', 'reason', 'moved', 'error']
  writeFileSync(
    MANIFEST,
    [
      header.join('\t'),
      ...rows.map((r) =>
        [r.record, r.fileId, r.fileName, r.from, r.to, r.reason, r.moved ? 'yes' : '', r.error]
          .map((c) => String(c).replace(/\t/g, ' '))
          .join('\t')
      ),
    ].join('\n')
  )
  console.log(`\n${D}manifest → ${MANIFEST}${O}`)
}

main().catch((err) => {
  console.error(`\n${R}failed${O}`, err instanceof Error ? err.message : err)
  process.exit(1)
})
