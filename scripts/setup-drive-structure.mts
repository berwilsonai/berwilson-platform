/**
 * Build the uniform Drive structure, and link every record to its folder.
 *
 *   node --no-deprecation --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/setup-drive-structure.mts [--apply] [--relink]
 *
 * Dry run by default; `--apply` writes. Idempotent — a second run reports
 * `created: 0, linked: 0` and changes nothing, which is the property the
 * verification step actually asserts (§12: a pass that reports what it did must
 * read before it writes).
 *
 * ⚠ CREATING IS ALL THIS DOES. It makes folders and sets
 * `drive_source_folder_id`; it never moves, renames, or trashes anything, and
 * so it needs NO scope beyond the `drive.file` the platform already holds —
 * adding a child to a human's folder on a SHARED drive is the impersonated
 * user's right, not the app's (CLAUDE.md §12, 09-16). Moving the existing files
 * is a separate pass under a temporary grant; see migrate-drive-structure.mts.
 *
 * ⚠ `--relink` RE-POINTS RECORDS THAT ALREADY HAVE A FOLDER, and is therefore
 * the one flag here that can lose work. Without it, only records with no link
 * at all are linked — safe at any time, and the useful half today, because 0 of
 * 7 opportunities have a folder. Run it only AFTER the migration has moved the
 * old folder's contents into the new one, or a record will point at an empty
 * folder while its documents sit in the old one.
 *
 * ⚠ A CONFIDENTIAL PROJECT GETS NO FOLDER. Drive is an outbound channel, and a
 * protected project leaves every one of them (§8) — a folder named after it in
 * the shared drive discloses the deal to the whole company whatever is inside.
 * `reconcile.ts` already filters publishing the same way; this matches it
 * rather than inventing a second rule.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { ensureFolder } from '@/lib/integrations/google-drive-write'
import { listSubfolders } from '@/lib/integrations/google-drive'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { STANDARD_FOLDERS, DILIGENCE_FOLDER, driveFolderName } from '@/lib/drive/classify'
import {
  DEFAULT_ROOM_TEMPLATE,
  HQ_FOLDER_ID,
  PROJECTS_SHELF,
  isRoomTemplateKey,
  roomFolderPaths,
  type RoomTemplateKey,
} from '@/lib/drive/data-room'

const G = '\x1b[32m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', O = '\x1b[0m'

const APPLY = process.argv.includes('--apply')
const RELINK = process.argv.includes('--relink')

/**
 * ⚠ BUILD ROOMS ONLY INSIDE FOLDERS THAT ALREADY EXIST — create and link nothing.
 *
 * Without this the pass would also create a folder for each of the 7 records
 * that have none and link them to it, and for at least three of them that is
 * actively wrong: `Cleveland Cliffs Industrial Sites Evaluation & Development`
 * has no link while `02 Projects/Data Center & Power Developments/Cleveland
 * Cliffs - New Richmond Ohio` holds 30 unclaimed documents, and Eagle Mountain
 * has an empty folder of its own already. Linking a record to a NEW empty
 * folder cements the wrong room and leaves the real one orphaned for good —
 * the same failure the room audit exists to surface, committed by the fix for
 * it. Which room is the real one is a judgement only a person has
 * (`project-folder-sync.ts`), so this flag takes that decision off the table.
 */
const LINKED_ONLY = process.argv.includes('--linked-only')

/**
 * `--blanks <n>` — pre-build n empty data rooms, plus the master template.
 *
 * Richard asked for 25 ready-made rooms so a new deal is a rename rather than a
 * build, and for the one-press clone as well (both, 10-29). This is the first
 * half: `_TEMPLATE — do not use` is the reference room, and `_NEW 01…n` are
 * claimable. The clone button in the platform renames the lowest unused `_NEW`
 * slot — one API call and the room exists instantly — and falls back to
 * building a fresh room when none is left.
 *
 * Named with a leading underscore and a trailing marker so neither can be
 * mistaken for a deal in a folder list a partner might see, and so an unclaimed
 * slot is obvious at a glance.
 */
const BLANKS = (() => {
  const i = process.argv.indexOf('--blanks')
  if (i < 0) return 0
  const n = Number(process.argv[i + 1])
  return Number.isInteger(n) && n > 0 && n <= 100 ? n : 0
})()

/**
 * `--blanks-only` — skip the shelves and the records, do just the blank rooms.
 *
 * ⚠ BECAUSE THE BLANK PHASE GETS KILLED AND HAS TO BE RESUMED. 26 rooms × 66
 * folders is ~1,700 Drive calls over roughly an hour, and this Mac Studio runs
 * at ~78MB free with 24GB of swap in use whenever LM Studio holds its 22GB of
 * weights — so a long-running process is collateral for the next memory
 * squeeze, and this one was killed after three rooms.
 *
 * Every phase here is idempotent, so resuming is just re-running — but the
 * record phase re-walks sixty paths for each of sixteen data-room records
 * before reaching the blanks, which is most of the cost and all of it wasted on
 * a resume. This flag makes a retry cheap enough to be the normal way to finish
 * the job.
 */
const BLANKS_ONLY = process.argv.includes('--blanks-only')

const TEMPLATE_ROOM_NAME = '_TEMPLATE — do not use'
const blankRoomName = (n: number) => `_NEW ${String(n).padStart(2, '0')} — (rename me)`

// `HQ_FOLDER_ID` and `PROJECTS_SHELF` now come from src/lib/drive/data-room.ts.
// They were declared here and AGAIN in migrate-drive-structure.mts, which is the
// drift §12 warns about: one script creates `02 Projects/<name>` and the other
// looks it up by that name, so a difference creates a second folder rather than
// finding the first — and a second folder per deal is the exact failure the room
// audit then found 157 orphaned documents inside.

/** The shelves. Numbered so Drive's own name sort IS the intended order. */
const SHELVES = [
  '00 Company Knowledge',
  '01 Corporate',
  '02 Projects',
  '03 Partners & Counterparties',
  '04 Brand & Media',
  '09 Divisions',
  '99 Archive',
] as const

/** Stands in for a folder id a dry run has not created yet. */
const PENDING = '<would be created>'

/** Subfolders of `00 Company Knowledge` — the only tree nominated to Ber AI. */
const KNOWLEDGE_SUBFOLDERS = [
  'Capabilities & Past Performance',
  'Certifications & Bonding',
  'Templates & Estimating',
  'Codes & Standards',
] as const

/** Subfolders of `01 Corporate`. Governance, deliberately NOT knowledge. */
const CORPORATE_SUBFOLDERS = [
  'Board & Resolutions',
  'Ownership',
  'NDAs',
  'Insurance',
  'Policies',
] as const

interface Record_ {
  id: string
  name: string
  kind: 'project' | 'opportunity'
  linked: string | null
  /** Which folder scheme this record's room is built from. */
  template: RoomTemplateKey
}

async function loadRecords(): Promise<Record_[]> {
  const supabase = createAdminClient()
  const out: Record_[] = []

  // `confidential` is read for the reason in the header, not for display.
  const { data: projects, error: pErr } = await supabase
    .from('projects')
    .select('id, name, drive_source_folder_id, confidential, data_room_template')
    .order('name')
  if (pErr) throw new Error(`projects: ${pErr.message}`)

  for (const p of projects ?? []) {
    const row = p as {
      id: string
      name: string | null
      drive_source_folder_id: string | null
      confidential: boolean | null
      data_room_template: string | null
    }
    if (row.confidential === true) {
      console.log(`  ${Y}skip${O}  ${row.name} ${D}(confidential — Drive is an outbound channel)${O}`)
      continue
    }
    if (!row.name?.trim()) continue
    out.push({
      id: row.id,
      name: row.name,
      kind: 'project',
      linked: row.drive_source_folder_id,
      // An unrecognised value reads as 'standard' — the safe direction, since
      // that is how every record behaved before the column existed.
      template: isRoomTemplateKey(row.data_room_template)
        ? row.data_room_template
        : DEFAULT_ROOM_TEMPLATE,
    })
  }

  const { data: opps, error: oErr } = await supabase
    .from('opportunities')
    .select('id, name, drive_source_folder_id, data_room_template')
    .order('name')
  if (oErr) throw new Error(`opportunities: ${oErr.message}`)

  for (const o of opps ?? []) {
    const row = o as {
      id: string
      name: string | null
      drive_source_folder_id: string | null
      data_room_template: string | null
    }
    if (!row.name?.trim()) continue
    out.push({
      id: row.id,
      name: row.name,
      kind: 'opportunity',
      linked: row.drive_source_folder_id,
      template: isRoomTemplateKey(row.data_room_template)
        ? row.data_room_template
        : DEFAULT_ROOM_TEMPLATE,
    })
  }

  return out
}

/**
 * A parent's children, listed ONCE per parent for the life of the process.
 *
 * ⚠ THE LIST CALL WAS PER PATH, NOT PER PARENT, and that is what made resuming
 * this job cost almost as much as running it. A data room has 66 paths under 24
 * distinct parents, so verifying an already-complete room spent 66 Drive
 * listings to learn 24 things — and on a box that keeps killing the process,
 * the cheapness of a resume is the whole difference between a job that finishes
 * and one that does not. Measured: 66 listings per room becomes 24.
 *
 * Safe to cache because this script is the only writer in its own run: a child
 * it creates is added to the cached list, so a later lookup sees it.
 */
const childCache = new Map<string, Map<string, string>>()

async function childrenOf(parentId: string): Promise<Map<string, string>> {
  const hit = childCache.get(parentId)
  if (hit) return hit
  const listed = await listSubfolders(parentId, { orderBy: 'name' })
  const byName = new Map(listed.map((f) => [f.name, f.id]))
  childCache.set(parentId, byName)
  return byName
}

/** Find-or-create, honouring the dry run. Returns null when it would create. */
async function ensure(
  name: string,
  parentId: string,
  tally: { created: number; existed: number }
): Promise<string | null> {
  const children = await childrenOf(parentId)
  const hit = children.get(name)
  if (hit) {
    tally.existed++
    return hit
  }
  tally.created++
  if (!APPLY) return null
  const made = await ensureFolder(name, parentId)
  // ⚠ Written back, or a sibling created in the same run lists as absent and is
  // created twice — which on a shared drive succeeds and leaves a duplicate.
  children.set(name, made.id)
  return made.id
}

/**
 * Find-or-create a whole PATH — `01 — Power & Property/01.5 — …/Drafts`.
 *
 * The existing `ensureFolderPath` in file-document.ts cannot serve: it walks
 * `folderSegments`, which knows about exactly one nesting special case (the
 * Diligence lanes) and treats everything else as a single folder however many
 * slashes it contains. That guard exists because a real Drive folder is named
 * `Fort Polk / Johnson - Design Build Matocc` and must never be split.
 *
 * Splitting is safe HERE because the paths come from `roomFolderPaths()`, whose
 * own test asserts no section label contains a slash — the structure is ours,
 * not a name read back off Drive.
 *
 * Memoised, because the template shares parents: 19 leaves under 3 parents plus
 * two status folders each is 60 paths per record, and re-listing `01 — Power &
 * Property` sixteen times is sixteen round trips for one answer.
 */
async function ensurePath(
  path: string,
  rootId: string,
  tally: { created: number; existed: number },
  memo: Map<string, string | null>
): Promise<string | null> {
  const key = `${rootId}::${path}`
  if (memo.has(key)) return memo.get(key)!

  const segments = path.split('/')
  let parent: string | null = rootId
  let walked = ''
  for (const segment of segments) {
    walked = walked ? `${walked}/${segment}` : segment
    const sub = `${rootId}::${walked}`
    if (memo.has(sub)) {
      parent = memo.get(sub)!
      continue
    }
    // A dry run cannot descend past the first folder it would have created, so
    // the rest of the path is counted and not listed. Under-counting here is
    // what makes a dry run read as reassurance (see the link-plan note below).
    const id: string | null = parent ? await ensure(segment, parent, tally) : null
    if (!parent) tally.created++
    memo.set(sub, id)
    parent = id
  }
  memo.set(key, parent)
  return parent
}

async function main(): Promise<void> {
  if (!isGoogleConfigured()) {
    console.error('Google Workspace is not configured — nothing to do.')
    process.exit(1)
  }

  console.log(`\n${B}=== Drive structure ===${O}`)
  console.log(APPLY ? `${G}APPLY${O} — folders will be created` : `${Y}DRY RUN${O} — nothing will be written (pass --apply)`)
  console.log(
    LINKED_ONLY
      ? `${D}--linked-only — building inside existing folders; creating and linking nothing${O}\n`
      : `${D}full pass — unlinked records will get a new folder and a link${O}\n`
  )

  const tally = { created: 0, existed: 0 }

  // --- 1. The shelves -----------------------------------------------------
  console.log(`${B}Shelves under Ber Wilson Proper (HQ)${O}`)
  const shelfIds = new Map<string, string | null>()
  for (const shelf of SHELVES) {
    const id = await ensure(shelf, HQ_FOLDER_ID, tally)
    shelfIds.set(shelf, id)
    console.log(`  ${id ? `${D}have${O}` : `${G}make${O}`}  ${shelf}`)
  }

  const knowledgeId = BLANKS_ONLY ? null : shelfIds.get('00 Company Knowledge')
  if (knowledgeId) {
    for (const sub of KNOWLEDGE_SUBFOLDERS) {
      const id = await ensure(sub, knowledgeId, tally)
      console.log(`    ${id ? `${D}have${O}` : `${G}make${O}`}  00 Company Knowledge/${sub}`)
    }
  }

  const corporateId = BLANKS_ONLY ? null : shelfIds.get('01 Corporate')
  if (corporateId) {
    for (const sub of CORPORATE_SUBFOLDERS) {
      const id = await ensure(sub, corporateId, tally)
      console.log(`    ${id ? `${D}have${O}` : `${G}make${O}`}  01 Corporate/${sub}`)
    }
  }

  // --- 2. One folder per record, with the standard set --------------------
  const projectsShelfId = shelfIds.get(PROJECTS_SHELF)
  if (!projectsShelfId && APPLY) throw new Error(`${PROJECTS_SHELF} could not be created`)

  const linkPlan: Array<{ record: Record_; folderId: string }> = []
  const records = BLANKS_ONLY ? [] : await loadRecords()
  if (!BLANKS_ONLY) console.log(`\n${B}Project folders${O}`)

  for (const record of records) {
    const folderName = driveFolderName(record.name)
    const paths = record.template === 'data_center' ? roomFolderPaths() : [...STANDARD_FOLDERS]
    const memo = new Map<string, string | null>()

    /**
     * ⚠ THE ROOM IS BUILT INSIDE THE FOLDER THE RECORD ALREADY POINTS AT, and
     * only created under `02 Projects` when there is no link at all.
     *
     * This was the other way round and it was wrong. Five records point outside
     * `02 Projects` entirely — Myton Development at `General Contracting / Build
     * Projects / USA | Canada / Utah / Myton Compute Campus`, West Wendover at a
     * child of the Trump City folder, Alaska under `Ber Earth` — so building
     * `02 Projects/<name>` for them would have raised nineteen folders in a room
     * nobody opens while every document stayed in the real one. That is the
     * exact duplication `audit-project-rooms.mts` had just finished measuring:
     * 157 documents in rooms no record points at.
     *
     * It is also the precedence `recordDriveFolder` already applies for filing —
     * the team's own folder wins, because a document belongs beside what the
     * team put there by hand (§12: a shared answer wired to one surface is worse
     * than no shared answer).
     */
    const existingRoom = record.linked
    let roomId: string | null = existingRoom

    if (!existingRoom && LINKED_ONLY) {
      console.log(
        `  ${Y}skip${O}  ${folderName}  ${D}no folder linked — resolve it against` +
          ` audit-project-rooms.mts rather than creating a second room${O}`
      )
      continue
    }

    if (!existingRoom) {
      if (!projectsShelfId) {
        console.log(
          `  ${G}make${O}  ${PROJECTS_SHELF}/${folderName}` +
            ` ${D}+ ${paths.length} subfolders (${record.template})${O}`
        )
        tally.created += 1 + paths.length
        linkPlan.push({ record, folderId: PENDING })
        continue
      }
      roomId = await ensure(folderName, projectsShelfId, tally)
      if (record.linked === null || RELINK) {
        linkPlan.push({ record, folderId: roomId ?? PENDING })
      }
    } else if (RELINK) {
      linkPlan.push({ record, folderId: existingRoom })
    }

    const before = tally.created
    if (roomId) {
      for (const path of paths) await ensurePath(path, roomId, tally, memo)
    } else {
      tally.created += paths.length
    }
    const made = tally.created - before

    const where = existingRoom ? `${D}(its own folder)${O}` : `${PROJECTS_SHELF}/${folderName}`
    const scheme = record.template === 'data_center' ? `${B}data room${O}` : `${D}standard${O}`
    console.log(
      `  ${made ? `${G}make${O}` : `${D}have${O}`}  ${folderName}  ${scheme} ${where}` +
        (made ? ` ${G}+${made} folders${O}` : '')
    )
  }

  console.log(
    `\n  ${D}${DILIGENCE_FOLDER} lanes are offered to the classifier and created on first use, not here.${O}`
  )

  // --- 2b. The master template and the claimable blanks ------------------
  if (BLANKS && projectsShelfId) {
    console.log(`\n${B}Blank rooms${O}`)
    const names = [TEMPLATE_ROOM_NAME, ...Array.from({ length: BLANKS }, (_, i) => blankRoomName(i + 1))]
    for (const name of names) {
      const memo = new Map<string, string | null>()
      const before = tally.created
      const roomId = await ensure(name, projectsShelfId, tally)
      if (roomId) {
        for (const path of roomFolderPaths()) await ensurePath(path, roomId, tally, memo)
      } else {
        tally.created += roomFolderPaths().length
      }
      const made = tally.created - before
      console.log(`  ${made ? `${G}make${O}` : `${D}have${O}`}  ${name}${made ? ` ${G}+${made}${O}` : ''}`)
    }
    console.log(
      `  ${D}Claim one by renaming it to "[Project] — [Location]" and linking it on the record,` +
        ` or let the platform claim the lowest unused slot for you.${O}`
    )
  } else if (BLANKS) {
    console.log(`\n${Y}--blanks needs ${PROJECTS_SHELF} to exist; run without --blanks first.${O}`)
  }

  // --- 3. Link ------------------------------------------------------------
  console.log(`\n${B}Links${O}`)
  if (linkPlan.length === 0) {
    console.log(`  ${D}nothing to link${O}`)
  }
  const supabase = createAdminClient()
  let linked = 0
  for (const { record, folderId } of linkPlan) {
    console.log(`  ${APPLY ? G + 'set ' + O : Y + 'plan' + O}  ${record.kind} "${record.name}" → ${folderId}`)
    if (!APPLY) continue
    if (folderId === PENDING) throw new Error(`${record.name}: folder id unresolved in an --apply run`)
    const { error } = await supabase
      .from(record.kind === 'project' ? 'projects' : 'opportunities')
      .update({ drive_source_folder_id: folderId })
      .eq('id', record.id)
    if (error) {
      console.error(`        ${Y}failed${O}: ${error.message}`)
      continue
    }
    linked++
  }

  console.log(
    `\n${B}folders created: ${tally.created}  already present: ${tally.existed}  records linked: ${linked}${O}`
  )
  if (!APPLY) console.log(`${Y}Dry run — re-run with --apply to write.${O}`)
  console.log()
}

main().catch((err) => {
  console.error('\nFailed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
