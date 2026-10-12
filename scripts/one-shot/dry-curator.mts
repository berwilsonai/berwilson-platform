/** Dry run of the curator. Decides everything, writes nothing. */
import { runCurator } from '@/lib/curator/run'

const r = await runCurator({ dryRun: true, force: true })
console.log(
  `considered ${r.considered}  protected-skipped ${r.skippedProtected}  ` +
    `would write ${r.fieldsWritten}  would ask ${r.fieldsProposed}  ` +
    `people enriched ${r.peopleEnriched}`
)
for (const o of r.outcomes) {
  console.log(`\n── ${o.kind}: ${o.name}  (${o.evidenceItems} evidence items)`)
  for (const w of o.written) console.log(`   WRITE  ${w.label}: ${trunc(w.from)} -> ${trunc(w.to)}`)
  for (const p of o.proposed) console.log(`   ASK    ${p.label}: ${trunc(p.from)} -> ${trunc(p.to)}  [${p.reason}]`)
}
console.log(`\n── contacts (deduped by party across the whole run)`)
for (const person of r.peopleOutcomes) {
  const bits = [
    ...person.written.map((w) => `${w.label}="${trunc(w.to)}"`),
    ...person.proposed.map((w) => `ASK ${w.label}`),
  ]
  console.log(`   ${person.name}: ${bits.join(', ')}`)
}
if (r.unmatchedPeople.length) {
  console.log(`\nnamed in the mail, matched to no contact (${r.unmatchedPeople.length}):`)
  console.log('  ' + r.unmatchedPeople.join(', '))
}
if (r.errors.length) {
  console.log('\nERRORS:')
  for (const e of r.errors) console.log('  ' + e)
}
function trunc(v: string | null): string {
  if (v === null) return '(blank)'
  return v.length > 60 ? `${v.slice(0, 57)}…` : v
}
