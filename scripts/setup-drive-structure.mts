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

const G = '\x1b[32m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', O = '\x1b[0m'

const APPLY = process.argv.includes('--apply')
const RELINK = process.argv.includes('--relink')

/**
 * `Ber Wilson Proper (HQ)` on the `Ber Wilson Proper` shared drive.
 *
 * Hard-coded rather than searched by name: a vendor's folder name is a UI
 * string, not an API contract (§12, 09-28 — matching "Meet Recordings" by name
 * had the importer report success against a Drive that had one for 192 runs).
 * An id cannot drift under a rename.
 */
const HQ_FOLDER_ID = '1RmNqygvuzKeEAMvX_3tAQ0FNszXet0K9'

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

const PROJECTS_SHELF = '02 Projects'

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
}

async function loadRecords(): Promise<Record_[]> {
  const supabase = createAdminClient()
  const out: Record_[] = []

  // `confidential` is read for the reason in the header, not for display.
  const { data: projects, error: pErr } = await supabase
    .from('projects')
    .select('id, name, drive_source_folder_id, confidential')
    .order('name')
  if (pErr) throw new Error(`projects: ${pErr.message}`)

  for (const p of projects ?? []) {
    const row = p as { id: string; name: string | null; drive_source_folder_id: string | null; confidential: boolean | null }
    if (row.confidential === true) {
      console.log(`  ${Y}skip${O}  ${row.name} ${D}(confidential — Drive is an outbound channel)${O}`)
      continue
    }
    if (!row.name?.trim()) continue
    out.push({ id: row.id, name: row.name, kind: 'project', linked: row.drive_source_folder_id })
  }

  const { data: opps, error: oErr } = await supabase
    .from('opportunities')
    .select('id, name, drive_source_folder_id')
    .order('name')
  if (oErr) throw new Error(`opportunities: ${oErr.message}`)

  for (const o of opps ?? []) {
    const row = o as { id: string; name: string | null; drive_source_folder_id: string | null }
    if (!row.name?.trim()) continue
    out.push({ id: row.id, name: row.name, kind: 'opportunity', linked: row.drive_source_folder_id })
  }

  return out
}

/** Find-or-create, honouring the dry run. Returns null when it would create. */
async function ensure(
  name: string,
  parentId: string,
  tally: { created: number; existed: number }
): Promise<string | null> {
  const existing = await listSubfolders(parentId, { orderBy: 'name' })
  const hit = existing.find((f) => f.name === name)
  if (hit) {
    tally.existed++
    return hit.id
  }
  tally.created++
  if (!APPLY) return null
  const made = await ensureFolder(name, parentId)
  return made.id
}

async function main(): Promise<void> {
  if (!isGoogleConfigured()) {
    console.error('Google Workspace is not configured — nothing to do.')
    process.exit(1)
  }

  console.log(`\n${B}=== Drive structure ===${O}`)
  console.log(APPLY ? `${G}APPLY${O} — folders will be created\n` : `${Y}DRY RUN${O} — nothing will be written (pass --apply)\n`)

  const tally = { created: 0, existed: 0 }

  // --- 1. The shelves -----------------------------------------------------
  console.log(`${B}Shelves under Ber Wilson Proper (HQ)${O}`)
  const shelfIds = new Map<string, string | null>()
  for (const shelf of SHELVES) {
    const id = await ensure(shelf, HQ_FOLDER_ID, tally)
    shelfIds.set(shelf, id)
    console.log(`  ${id ? `${D}have${O}` : `${G}make${O}`}  ${shelf}`)
  }

  const knowledgeId = shelfIds.get('00 Company Knowledge')
  if (knowledgeId) {
    for (const sub of KNOWLEDGE_SUBFOLDERS) {
      const id = await ensure(sub, knowledgeId, tally)
      console.log(`    ${id ? `${D}have${O}` : `${G}make${O}`}  00 Company Knowledge/${sub}`)
    }
  }

  const corporateId = shelfIds.get('01 Corporate')
  if (corporateId) {
    for (const sub of CORPORATE_SUBFOLDERS) {
      const id = await ensure(sub, corporateId, tally)
      console.log(`    ${id ? `${D}have${O}` : `${G}make${O}`}  01 Corporate/${sub}`)
    }
  }

  // --- 2. One folder per record, with the standard set --------------------
  const projectsShelfId = shelfIds.get(PROJECTS_SHELF)
  if (!projectsShelfId && APPLY) throw new Error(`${PROJECTS_SHELF} could not be created`)

  console.log(`\n${B}Project folders${O}`)
  const records = await loadRecords()
  const linkPlan: Array<{ record: Record_; folderId: string }> = []

  for (const record of records) {
    const folderName = driveFolderName(record.name)

    if (!projectsShelfId) {
      // Dry run before the shelf exists: we can describe, not descend. The link
      // is still planned here — this branch swallowing it is what made the first
      // dry run print "nothing to link" over 21 records that all needed one.
      console.log(`  ${G}make${O}  ${PROJECTS_SHELF}/${folderName} ${D}+ ${STANDARD_FOLDERS.length} subfolders${O}`)
      tally.created += 1 + STANDARD_FOLDERS.length
      if (record.linked === null || RELINK) linkPlan.push({ record, folderId: PENDING })
      continue
    }

    const folderId = await ensure(folderName, projectsShelfId, tally)
    const made: string[] = []
    if (folderId) {
      for (const sub of STANDARD_FOLDERS) {
        const before = tally.created
        await ensure(sub, folderId, tally)
        if (tally.created > before) made.push(sub)
      }
    } else {
      tally.created += STANDARD_FOLDERS.length
    }

    // ⚠ Planned OUTSIDE the `if (folderId)` above, which is where it sat and was
    // wrong: on a dry run every folder is yet to be created, so folderId is null
    // for all of them and the plan came back empty — "nothing to link" printed
    // over 21 records that all needed linking. A dry run that under-reports the
    // work is worse than no dry run, because it is read as reassurance.
    if (record.linked === null || RELINK) {
      linkPlan.push({ record, folderId: folderId ?? PENDING })
    }

    const linkNote =
      record.linked === null
        ? `${Y}unlinked${O}`
        : RELINK
          ? `${Y}relink${O}`
          : `${D}linked${O}`
    console.log(
      `  ${folderId ? `${D}have${O}` : `${G}make${O}`}  ${folderName}  ${linkNote}` +
        (made.length ? ` ${D}+${made.length} subfolders${O}` : '')
    )
  }

  console.log(
    `\n  ${D}${DILIGENCE_FOLDER} lanes are offered to the classifier and created on first use, not here.${O}`
  )

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
