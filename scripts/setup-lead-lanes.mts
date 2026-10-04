#!/usr/bin/env node
/**
 * Create the Drive folder a handoff lane publishes into, and record its id.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/setup-lead-lanes.mts [--apply] [key...]
 *
 * Without --apply it prints what it would create and changes nothing.
 *
 * Why this exists rather than a line in the runbook: `drive_folder_id` is the
 * one field on a `lead_categories` row that cannot be typed into the settings
 * screen from nothing. A lane with no folder id does not publish files at all
 * (`publishLeadToCategoryFolder` returns null and says so), so three lanes —
 * plumbing, HVAC, flooring — shipped inert, and the only way to fill the field
 * by hand is to go and make a folder in Drive and copy its id back.
 *
 * The folders are created under the app's own `Ber Intelligence` root, in
 * PRIMARY_MAILBOX's Drive, beside the `Lead Lists` shelf the per-lane sheets
 * already live on. That keeps the §12 (09-16) `drive.file` contract satisfied
 * for free: the platform created these folders, so it may write children into
 * them. A folder a HUMAN made is still a valid value for the field — paste its
 * id in settings and this script leaves the lane alone.
 *
 * Idempotent in both directions: `ensureFolder` resolves an existing folder by
 * name before creating one, and a lane that already carries an id is skipped
 * and reported as skipped rather than silently re-pointed. Run it again after
 * adding a line of business.
 *
 * It does NOT grant sharing. `share_with` is what grants it, asserted on every
 * sweep by `assertCategoryFolderSharing` — and the first grant to an outside
 * address sends that person a "you now have access" mail, which is not
 * something a setup script should fire as a side effect.
 */

import { ensureFolder, ensureRootFolder, folderUrl } from '@/lib/integrations/google-drive-write'
import { PRIMARY_MAILBOX, isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { listCategories, invalidateCategoryCache } from '@/lib/leads/categories'
import { leadsDb } from '@/lib/leads/db'

/** The shelf the lane folders sit on, beside `Lead Lists`. */
const SECTION = 'Lead Folders'

const G = '\x1b[32m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', O = '\x1b[0m'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const only = args.filter((a) => !a.startsWith('--')).map((a) => a.toLowerCase())

  if (!isGoogleConfigured()) {
    console.error('Google is not configured — nothing to do. See isGoogleConfigured().')
    process.exit(1)
  }

  const all = await listCategories()
  const lanes = all.filter(
    (c) => c.destination === 'handoff' && c.active && (only.length === 0 || only.includes(c.key))
  )

  console.log(`\n${B}=== Lead lane Drive folders ===${O}`)
  console.log(`${D}mailbox: ${PRIMARY_MAILBOX} · shelf: ${SECTION} · ${apply ? 'APPLY' : 'dry run'}${O}\n`)

  if (lanes.length === 0) {
    console.log('No active handoff lanes matched.')
    return
  }

  // Resolved once, outside the loop: every lane hangs off the same shelf, and
  // ensureRootFolder shares the root with the domain on first creation.
  const root = apply ? await ensureRootFolder() : null
  const shelf = apply && root ? await ensureFolder(SECTION, root.id) : null

  for (const lane of lanes) {
    if (lane.drive_folder_id) {
      console.log(`  ${Y}skip${O}  ${lane.label} ${D}— already has a folder (${lane.drive_folder_id})${O}`)
      continue
    }

    const name = `${lane.label} Leads`
    if (!apply || !shelf) {
      console.log(`  ${D}would create${O}  ${name}`)
      continue
    }

    const folder = await ensureFolder(name, shelf.id)
    const { error } = await leadsDb()
      .from('lead_categories')
      .update({ drive_folder_id: folder.id })
      .eq('id', lane.id)

    if (error) {
      console.log(`  ${Y}FAIL${O}  ${name} — folder ${folder.id} created but not recorded: ${error.message}`)
      continue
    }
    console.log(`  ${G}ok${O}    ${name}\n        ${D}${folderUrl(folder.id)}${O}`)
  }

  if (apply) invalidateCategoryCache()

  const unaddressed = lanes.filter((l) => !l.handoff_email)
  if (unaddressed.length > 0) {
    console.log(
      `\n${Y}NOTE${O}  no handoff address on: ${unaddressed.map((l) => l.label).join(', ')}.` +
        '\n      A folder without an address still cannot be handed off — the button stays' +
        '\n      disabled. Set it at /settings/lead-categories.'
    )
  }
  console.log()
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
