/**
 * Run the curator twice and assert the second run changes nothing.
 *
 * ⚠ §12 REQUIRES THIS PAIRING BY NAME: "a pass that reports what it did must
 * read before it writes, or it claims work it did not do — pair every
 * fill-not-overwrite pass with a script that calls it TWICE and asserts the
 * second run reports nothing." The separation pass announced "org chart marked
 * departed" on a second run having changed nothing, and idempotent and honest
 * are different properties: the value of a report is that the reader can
 * believe it.
 *
 * It matters more here than anywhere else in the repo, because this pass writes
 * unattended and its report is read out in the morning text. A curator that
 * re-reports the same seventeen fields every night would train both executives
 * to ignore the one message that tells them what changed.
 *
 * ⚠ `force: true` on both runs, deliberately — otherwise the per-record cursor
 * would make the second run trivially empty and the test would prove nothing
 * about the writes.
 *
 * Run: node --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/verify-curator-idempotent.mts
 */
import { runCurator } from '@/lib/curator/run'

const first = await runCurator({ dryRun: false, force: true })
console.log(
  `run 1: wrote ${first.fieldsWritten}, asked ${first.fieldsProposed}, ` +
    `people ${first.peopleEnriched}, errors ${first.errors.length}`
)
for (const e of first.errors) console.log(`  ERROR ${e}`)

const second = await runCurator({ dryRun: false, force: true })
console.log(
  `run 2: wrote ${second.fieldsWritten}, asked ${second.fieldsProposed}, ` +
    `people ${second.peopleEnriched}, errors ${second.errors.length}`
)
for (const e of second.errors) console.log(`  ERROR ${e}`)

let failures = 0
if (second.fieldsWritten !== 0) {
  console.log(`FAIL  the second run wrote ${second.fieldsWritten} field(s); it must write none`)
  for (const o of second.outcomes) {
    for (const w of o.written) console.log(`      ${o.name}: ${w.label} ${w.from} -> ${w.to} (${w.reason})`)
  }
  for (const p of second.peopleOutcomes) {
    for (const w of p.written) console.log(`      ${p.name}: ${w.label} ${w.from} -> ${w.to} (${w.reason})`)
  }
  failures += 1
}
if (second.errors.length > 0) {
  console.log('FAIL  the second run reported errors')
  failures += 1
}
// A re-proposal is an UPDATE of the same open question, not a new one, so the
// count may legitimately repeat — but it must not GROW.
if (second.fieldsProposed > first.fieldsProposed) {
  console.log(
    `FAIL  proposals grew on the second run (${first.fieldsProposed} -> ${second.fieldsProposed})`
  )
  failures += 1
}

console.log('')
if (failures > 0) {
  console.log(`${failures} failure(s). The curator is not idempotent.`)
  process.exitCode = 1
} else {
  console.log('Curator is idempotent: the second run reported nothing.')
}
