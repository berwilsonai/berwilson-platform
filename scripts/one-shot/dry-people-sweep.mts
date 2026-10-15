/** Dry run of the rolodex sweep. Writes nothing; prints every proposed change. */
import people from '@/lib/curator/people'

const r = await people.runPeopleSweep({ dryRun: true })

console.log({
  threadsRead: r.threadsRead,
  mentions: r.mentions,
  contactsTouched: r.outcomes.length,
  fieldsWritten: r.fieldsWritten,
  fieldsProposed: r.fieldsProposed,
  unmatched: r.unmatched.length,
  evidenceThrough: r.evidenceThrough,
  error: r.error,
})

for (const o of r.outcomes) {
  const w = o.written.map((f) => `${f.label}: ${f.from ?? '(blank)'} -> ${f.to}`)
  const p = o.proposed.map((f) => `${f.label}: ${f.from ?? '(blank)'} -> ${f.to}  [ASK]`)
  if (w.length === 0 && p.length === 0) continue
  console.log(`\n${o.name}`)
  for (const line of [...w, ...p]) console.log(`   ${line}`)
}

if (r.unmatched.length > 0) {
  console.log(`\n── named in the mail, in no contact record (${r.unmatched.length}) ──`)
  console.log('   ' + r.unmatched.slice(0, 40).join(', '))
}
