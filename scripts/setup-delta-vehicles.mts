/**
 * Stand up the Delta Industrial Campus vehicles.
 *
 *   node --no-deprecation --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/setup-delta-vehicles.mts [--apply]
 *
 * ⚠ IT CREATES THE STRUCTURE AND NOT THE CAP TABLES. The three vehicles are a
 * known structural fact — Richard's stated trio, and `DEFAULT_SPV_PURPOSES` is
 * exactly it. The holders and splits are NOT in the platform: there are no
 * participant rows anywhere, no Delta SPV in `org_nodes`, no SPV `entities`,
 * no `investments`, and nothing in the Delta correspondence states an equity
 * percentage. A ledger invented to fill the screen would be read by
 * `resolveBwShare` as our actual share, so it is left undetermined — which the
 * engine holds out of the net total rather than counting (CLAUDE.md §12).
 *
 * ⚠ IT GOES THROUGH `createStandardVehicles`, THE SAME FUNCTION THE BUTTON
 * CALLS. Re-writing the naming and dedupe rules here would be a second copy of
 * a shared pass, which is the one that keeps the bug when the other is fixed.
 *
 * Dry run by default; `--apply` writes. Idempotent — a second run reports
 * `created: 0` and changes nothing.
 */

import { createStandardVehicles, standardVehicleName } from '@/lib/spvs/standard'
import { loadProjectSpvs } from '@/lib/spvs/queries'
import { spvDb } from '@/lib/spvs/db'
import { DEFAULT_SPV_PURPOSES, SPV_PURPOSE_LABELS } from '@/lib/spvs/types'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

const apply = process.argv.includes('--apply')

// ⚠ THE PREFIX IS NOT THE PROJECT NAME. The project is "Delta Industrial
// Campus — Daves Farms", which would produce "Delta Industrial Campus — Daves
// Farms Land LLC" — a string nobody would put on a signature block, and one
// carrying the SELLER's name into the name of our own vehicle. "Delta" matches
// the convention already in the org chart (Myton Energy SPV, Stockton 150MW
// SPV): the place, then the purpose.
const PREFIX = 'Delta'

// Resolved by name rather than hardcoded, so this script says what it could not
// find instead of writing to a uuid that may have moved.
const PROJECT_NAME_MATCH = 'Delta Industrial Campus'

async function main() {
  const db = spvDb()

  const { data: projects, error } = await db
    .from('projects')
    .select('id,name')
    .ilike('name', `%${PROJECT_NAME_MATCH}%`)
  if (error) throw new Error(`Could not read projects: ${error.message}`)

  const rows = (projects ?? []) as { id: string; name: string }[]
  // ⚠ AMBIGUITY MUST MEAN NO MATCH (§12, 09-09). Two projects sharing the name
  // is the case that must refuse, not pick one and write a cap table into it.
  if (rows.length !== 1) {
    throw new Error(
      rows.length === 0
        ? `No project matches "${PROJECT_NAME_MATCH}".`
        : `${rows.length} projects match "${PROJECT_NAME_MATCH}": ${rows.map((r) => r.name).join(', ')}. Refusing to guess.`
    )
  }
  const project = rows[0]
  console.log(`${BOLD}${project.name}${OFF} ${DIM}${project.id}${OFF}\n`)

  const before = await loadProjectSpvs('project', project.id)
  console.log(`Vehicles already on this deal: ${before.length}`)
  for (const v of before) {
    console.log(`  ${DIM}·${OFF} ${v.label} ${DIM}(${SPV_PURPOSE_LABELS[v.purpose]}, ${v.participants.length} participant(s))${OFF}`)
  }

  console.log(`\n${BOLD}Would create:${OFF}`)
  const existingLabels = new Set(before.map((v) => v.label))
  for (const purpose of DEFAULT_SPV_PURPOSES) {
    const name = standardVehicleName(purpose, PREFIX)
    console.log(
      existingLabels.has(name)
        ? `  ${DIM}· ${name} — already there, will be skipped${OFF}`
        : `  ${GREEN}+${OFF} ${name} ${DIM}(${SPV_PURPOSE_LABELS[purpose]})${OFF}`
    )
  }

  if (!apply) {
    console.log(`\n${DIM}Dry run. Re-run with --apply to write.${OFF}`)
    return
  }

  const actor = { id: '00000000-0000-0000-0000-000000000000', email: 'setup@berwilson.com' }
  const result = await createStandardVehicles({
    kind: 'project',
    recordId: project.id,
    prefix: PREFIX,
    actor,
  })
  if ('error' in result) throw new Error(result.error)

  console.log(`\n${GREEN}created ${result.created}, skipped ${result.skipped}${OFF}`)

  // ⚠ READ BACK, DO NOT TRUST THE RETURN. A pass that reports what it did must
  // read before it claims (§12, 09-30), and this one is about to tell a human
  // their deal is structured.
  const after = await loadProjectSpvs('project', project.id)
  console.log(`\n${BOLD}On the deal now:${OFF}`)
  for (const v of after) {
    console.log(
      `  ${v.label} ${DIM}— ${SPV_PURPOSE_LABELS[v.purpose]}, ${v.participants.length} participant(s), ` +
        `our share ${v.bwOwnershipPct ?? 'undetermined'}, entity ${v.entityId ? 'linked' : 'not formed'}${OFF}`
    )
  }
  console.log(
    `\n${DIM}No participants and no splits were created — nothing on file states them. ` +
      `Every vehicle reports our share as undetermined, which the engine holds out of the net total.${OFF}`
  )
}

main().catch((err) => {
  console.error(`${RED}✗ ${err instanceof Error ? err.message : String(err)}${OFF}`)
  process.exit(1)
})
