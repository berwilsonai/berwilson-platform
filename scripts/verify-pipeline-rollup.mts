/**
 * The program rollup, proved against the real database.
 *
 *   node --no-deprecation --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/verify-pipeline-rollup.mts
 *
 * `npm test` proves the pure rules in src/lib/records/pipeline-value.test.ts
 * with no database. This proves the half only the live stack can answer: that
 * the rollup reads real `projects` rows correctly, with a real parent and a
 * real child in the set.
 *
 * ⚠ THIS FILE IS WHAT SURVIVED `scripts/verify-deal-flow.mts`, removed with the
 * Vehicles module on 2026-10-23. Four of its five sections were about vehicles
 * and went with them; this one is about `pipeline-value.ts`, which did not.
 * Deleting the script wholesale would have deleted the only live-data check of
 * the rollup — the §12 trap where removing a directory removes the only tests
 * for whatever outlives it.
 *
 * Creates throwaway records and removes everything in a `finally` even when an
 * assertion fails.
 */

import { leafRecords, portfolioTotal, rolledPipelineValue } from '@/lib/records/pipeline-value'
import { createUntypedAdminClient } from '@/lib/supabase/admin'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

let failures = 0
function check(label: string, pass: boolean, detail = ''): void {
  if (!pass) failures += 1
  console.log(`  ${pass ? `${GREEN}✓` : `${RED}✗`}${OFF} ${label}${detail ? ` ${DIM}${detail}${OFF}` : ''}`)
}

const actor = { id: '00000000-0000-0000-0000-000000000000', email: 'verify@berwilson.com' }
const db = createUntypedAdminClient()
const write = createUntypedAdminClient(actor)
const stamp = Date.now()

let parentId: string | null = null
let childId: string | null = null

try {
  const project = async (name: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await write
      .from('projects')
      .insert({ name: `ZZZ verify rollup ${stamp} ${name}`, sector: 'infrastructure', ...extra })
      .select('id')
      .single()
    if (error) throw new Error(`Could not create project ${name}: ${error.message}`)
    return (data as { id: string }).id
  }

  // ⚠ `estimated_value`, NOT `economics_capture_value`. These fixtures used the
  // computed column until the calculator was removed on 2026-10-23 and the
  // column was dropped with it — which would have failed the whole insert with
  // a 42703 rather than one field (§12, a value outside the schema fails the
  // query and not the row). `pipelineValue` reads one column.
  parentId = await project('program', { estimated_value: 100_000_000 })
  childId = await project('phase 1', {
    parent_project_id: parentId,
    estimated_value: 40_000_000,
  })

  console.log(`\n${BOLD}A program and its sub-projects are not two deals${OFF}`)

  const { data: liveProjects, error: liveError } = await db
    .from('projects')
    .select('id,name,parent_project_id,estimated_value')
    .limit(1000)
  if (liveError) throw new Error(`Could not read projects: ${liveError.message}`)
  const rows = (liveProjects ?? []) as {
    id: string
    parent_project_id: string | null
    estimated_value: number | string | null
  }[]

  const leaves = leafRecords(rows)
  check(
    'the program is held out of the leaf set',
    leaves.every((r) => r.id !== parentId) && leaves.some((r) => r.id === childId),
    `${leaves.length} leaves of ${rows.length} projects`
  )
  const total = portfolioTotal(rows)
  check('and the portfolio total reports what it rolled up', total.rolledUp >= 1, `${total.rolledUp}`)

  const rolled = rolledPipelineValue(rows.find((r) => r.id === parentId)!, rows)
  check(
    "the program's value is its child's $40M, not its own $100M",
    rolled.amount === 40_000_000,
    `${rolled.amount}`
  )
  check(
    'and the overruled $100M is handed back rather than dropped silently',
    rolled.ownValue?.amount === 100_000_000,
    `${rolled.ownValue?.amount}`
  )
  // The arithmetic that was live before the rollup existed: parent + children.
  check(
    'the old behaviour would have reported $140M — the bug this fixes',
    100_000_000 + 40_000_000 === 140_000_000 && rolled.amount !== 140_000_000
  )
} catch (error) {
  // ⚠ SAY WHAT THREW. A `finally` that calls process.exit swallows the throw it
  // is unwinding, so an exception halfway down this file would look exactly
  // like the checks below it having silently not run (§12, 10-06).
  failures += 1
  console.log(
    `  ${RED}✗${OFF} the script threw: ${RED}${error instanceof Error ? error.message : String(error)}${OFF}`
  )
} finally {
  for (const id of [childId, parentId]) {
    if (id) await write.from('projects').delete().eq('id', id)
  }

  const { count: auditRows } = await db
    .from('activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('actor_email', actor.email)
  if ((auditRows ?? 0) > 0) {
    console.log(
      `\n${DIM}${auditRows} audit row(s) in activity_log are from this script. To clear them:${OFF}`
    )
    console.log(
      `${DIM}  docker exec supabase-db psql -U postgres -c "delete from activity_log where actor_email = '${actor.email}';"${OFF}`
    )
  }

  console.log(
    failures === 0
      ? `\n${GREEN}${BOLD}All checks passed.${OFF} Every record this run created was removed.`
      : `\n${RED}${BOLD}${failures} check(s) failed.${OFF}`
  )
  process.exit(failures === 0 ? 0 : 1)
}
