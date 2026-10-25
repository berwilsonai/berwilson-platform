/**
 * Import the files sitting on deal mail that belongs to no record.
 *
 * The one-off drain for the 809-attachment backlog measured on 2026-10-25. The
 * hourly sweep now runs the same pass (`unparented` phase) at 25 threads a run,
 * so this exists to move the backlog faster and — more importantly — to be run
 * TWICE, because a fill-not-overwrite pass is not proven until the second run
 * reports nothing (§12).
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *     --env-file=.env.local scripts/drain-unparented-attachments.mts [--limit N]
 *
 * ⚠ COSTS A DOCUMENT AI PASS PER FILE (~30s on the local model), so it competes
 * with every other model-bound pass for the single LM Studio slot. Run it when
 * the hourly sweep is not mid-flight.
 */

import { importUnparentedAttachments } from '../src/lib/email-sweep/apply-phase.ts'
import { createAdminClient } from '../src/lib/supabase/admin.ts'

const arg = process.argv.indexOf('--limit')
const limit = arg >= 0 ? Number(process.argv[arg + 1]) : 5
if (!Number.isFinite(limit) || limit <= 0) {
  console.error('--limit must be a positive number')
  process.exit(1)
}

const db = createAdminClient()

/** What is owed, and what has landed. Printed before and after, so the run's
 *  own report can be checked against the database rather than believed. */
async function state() {
  const { count: docs } = await db
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .is('project_id', null)
    .eq('is_company', false)
    .not('source_thread_id', 'is', null)
  return { docs: docs ?? 0 }
}

const before = await state()
console.log(`before: ${before.docs} unparented documents on file\n`)

const r = await importUnparentedAttachments({
  limit,
  budgetMs: 30 * 60 * 1000,
})

console.log('\nrun reported:', JSON.stringify(r, null, 2))

const after = await state()
console.log(`\nafter: ${after.docs} unparented documents on file (+${after.docs - before.docs})`)

// ⚠ THE RUN'S OWN NUMBER, CHECKED AGAINST THE DATABASE. A pass that reports
// what it did must read before it writes, or it claims work it did not do
// (§12). These two can legitimately differ — a file can be skipped as a
// duplicate hash or as mail chrome, both of which count as examined and import
// nothing — so this prints the gap rather than asserting it away.
if (r.imported !== after.docs - before.docs) {
  console.log(
    `\n⚠ the run claimed ${r.imported} imported and the table grew by ${
      after.docs - before.docs
    }. Expected when files were deduped or rejected as chrome; investigate if the table grew LESS than claimed.`
  )
}

if (r.threadsPending > r.threadsConsidered) {
  console.log(
    `\n${r.threadsPending - r.threadsConsidered} threads still owed a read — run again or let the hourly sweep drain it.`
  )
}
process.exit(0)
