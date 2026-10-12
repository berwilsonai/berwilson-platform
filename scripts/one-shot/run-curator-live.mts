/** Run the curator for real, once, and print exactly what it changed. */
import { runCurator } from '@/lib/curator/run'
const r = await runCurator({ dryRun: false, force: true })
console.log(JSON.stringify({
  ok: r.ok, considered: r.considered, skippedProtected: r.skippedProtected,
  fieldsWritten: r.fieldsWritten, fieldsProposed: r.fieldsProposed,
  peopleEnriched: r.peopleEnriched, unmatched: r.unmatchedPeople.length, errors: r.errors,
}, null, 2))
for (const o of r.outcomes) for (const w of o.written) console.log(`  ${o.name}: ${w.label} = ${w.to}`)
for (const p of r.peopleOutcomes) console.log(`  ${p.name}: ${p.written.map((w) => `${w.label}=${w.to}`).join(', ')}`)
