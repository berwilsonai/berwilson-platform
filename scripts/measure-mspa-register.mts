/**
 * Re-measure the MSPA register against the live database.
 *
 * ⚠ A HAND-WRITTEN REGISTER DRIFTS THE MOMENT A RECORD IS RENAMED OR ADDED, and
 * nothing reports it. This script is the check: every register row must name a
 * real project or opportunity, and every project and opportunity must appear in
 * the register. It prints both gaps and exits non-zero if either exists.
 *
 * Run: node --env-file=.env.local --import ./deploy/register.mjs scripts/measure-mspa-register.mts
 */

import { createUntypedAdminClient } from '../src/lib/supabase/admin'
import mspaRegister from '../src/lib/mspa/register'

const { MSPA_REGISTER, summarizeRegister } = mspaRegister

async function main() {
  const db = createUntypedAdminClient()

  const [projects, opportunities] = await Promise.all([
    db.from('projects').select('name'),
    db.from('opportunities').select('name'),
  ])

  if (projects.error) throw new Error(`projects: ${projects.error.message}`)
  if (opportunities.error) throw new Error(`opportunities: ${opportunities.error.message}`)

  const live = new Map<string, 'project' | 'opportunity'>()
  for (const row of projects.data ?? []) live.set(row.name as string, 'project')
  for (const row of opportunities.data ?? []) live.set(row.name as string, 'opportunity')

  const registered = new Set(MSPA_REGISTER.map((r) => r.name))

  const missingFromRegister = [...live.keys()].filter((n) => !registered.has(n))
  const notInDatabase = MSPA_REGISTER.filter((r) => !live.has(r.name))
  const wrongKind = MSPA_REGISTER.filter(
    (r) => live.has(r.name) && live.get(r.name) !== r.kind
  )

  const s = summarizeRegister()
  console.log('── MSPA register ─────────────────────────────────────────────')
  console.log(`live records            ${live.size} (${projects.data?.length} projects, ${opportunities.data?.length} opportunities)`)
  console.log(`register rows           ${s.total}`)
  console.log(`  in scope              ${s.inScope}`)
  console.log(`  covered but unsized   ${s.unsized}`)
  console.log(`  out of scope          ${s.outOfScope}`)
  console.log(`with a stated MW        ${s.withStatedMw}`)
  console.log(`with a CONFIRMED basis  ${s.withConfirmedBasis}`)
  console.log(`with a signed PCA       ${s.withSignedPca}`)
  console.log(`with site control       ${s.withSiteControl}`)
  console.log(`with a cost estimate    ${s.withCostEstimate}`)
  console.log('')

  let bad = false
  if (missingFromRegister.length) {
    bad = true
    console.log(`⚠ ${missingFromRegister.length} live record(s) are NOT in the register:`)
    for (const n of missingFromRegister) console.log(`    ${n} (${live.get(n)})`)
  }
  if (notInDatabase.length) {
    bad = true
    console.log(`⚠ ${notInDatabase.length} register row(s) name no live record:`)
    for (const r of notInDatabase) console.log(`    ${r.name}`)
  }
  if (wrongKind.length) {
    bad = true
    console.log(`⚠ ${wrongKind.length} register row(s) have the wrong kind:`)
    for (const r of wrongKind)
      console.log(`    ${r.name}: register says ${r.kind}, database says ${live.get(r.name)}`)
  }
  if (!bad) console.log('✓ register and database agree on every record')

  process.exitCode = bad ? 1 : 0
}

await main()
