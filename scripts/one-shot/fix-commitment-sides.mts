/**
 * Re-side the open ledger's rows whose named owner is one of ours.
 *
 * The write-time fix lives in `src/lib/commitments/side.ts` and only touches
 * rows extracted from now on. This moves the backlog it was measured against:
 * 32 of 164 open `side='them'` rows naming Richard or Eric.
 *
 * ⚠ DRY BY DEFAULT. Pass `--apply` to write. §12: a pass that reports what it
 * did must read before it writes, and running it twice must report nothing the
 * second time — which is the assertion at the foot of this file.
 */
// ⚠ NAMED IMPORTS, RUN UNDER `deploy/register.mjs` — NOT `tsx`. The sibling
// dry-aging.mts carries a note prescribing DEFAULT imports, which is true of
// tsx (CJS namespaces, where an `export const` does not survive the lexer) and
// false here: register.mjs resolves these as real ESM and a default import
// fails outright. §12's rule about re-testing a workaround's recorded reason
// before inheriting it — run the script under the loader `npm test` uses
// before reshaping exports to suit the other one.
import { correctSides } from '@/lib/commitments/side'
import { loadPepperMembers } from '@/lib/pepper/attribution'
import { sweepDb } from '@/lib/email-sweep/db'

const APPLY = process.argv.includes('--apply')

const db = sweepDb()
const members = await loadPepperMembers(db)
console.log(`roster: ${members.map((m) => `${m.name} [${[...m.tokens].join('/')}]`).join(', ')}\n`)

const { data, error } = await db
  .from('commitments')
  .select('id, what, side, owner_name, status')
  .eq('status', 'open')
  .eq('side', 'them')
  .limit(1000)

if (error) throw new Error(error.message)
const rows = (data ?? []) as {
  id: string
  what: string
  side: 'us' | 'them'
  owner_name: string | null
}[]

const { corrections } = correctSides(rows, members)

console.log(`${rows.length} open rows filed as the counterparty's.`)
console.log(`${corrections.length} name one of ours and should be our work.\n`)

for (const c of corrections) {
  const r = rows[c.index]
  console.log(`  ${c.ownerName.padEnd(18)} → ${c.memberId.padEnd(8)} ${r.what.slice(0, 68)}`)
}

if (!APPLY) {
  console.log('\nDry run. Pass --apply to write.')
  process.exit(0)
}

let moved = 0
for (const c of corrections) {
  const { error: writeError } = await db
    .from('commitments')
    .update({ side: 'us' })
    .eq('id', rows[c.index].id)
    // Only if it is still what we read — two sessions share this box and the
    // sweep runs hourly.
    .eq('side', 'them')
  if (writeError) console.error(`  FAILED ${rows[c.index].id}: ${writeError.message}`)
  else moved++
}
console.log(`\nmoved ${moved} of ${corrections.length} to side='us'.`)

// §12: pair a fill-not-overwrite pass with a second run that must report
// nothing. Done inline so it cannot be forgotten.
const { data: after } = await db
  .from('commitments')
  .select('id, side, owner_name')
  .eq('status', 'open')
  .eq('side', 'them')
  .limit(1000)
const { corrections: second } = correctSides(
  (after ?? []) as { side: 'us' | 'them'; owner_name: string | null }[],
  members
)
console.log(
  second.length === 0
    ? 'second pass: nothing left to correct ✓'
    : `⚠ second pass still finds ${second.length} — the write did not take`
)
