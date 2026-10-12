/**
 * What the curator would actually see, per record. No model, no writes.
 *
 * §12: measure before building. The point is to find out whether the evidence
 * links exist at all before writing a prompt that assumes they do.
 */
import { gatherEvidence } from '@/lib/curator/evidence'
import { provDb } from '@/lib/provenance/db'

const [projects, opportunities] = await Promise.all([
  provDb().from('projects').select('id, name, confidential').order('name'),
  provDb().from('opportunities').select('id, name').order('name'),
])
if (projects.error) throw new Error(`projects: ${projects.error.message}`)
if (opportunities.error) throw new Error(`opportunities: ${opportunities.error.message}`)

const rows: { kind: 'project' | 'opportunity'; id: string; name: string; conf: boolean }[] = [
  ...(projects.data ?? []).map((p: Record<string, unknown>) => ({
    kind: 'project' as const, id: String(p.id), name: String(p.name), conf: Boolean(p.confidential),
  })),
  ...(opportunities.data ?? []).map((o: Record<string, unknown>) => ({
    kind: 'opportunity' as const, id: String(o.id), name: String(o.name), conf: false,
  })),
]

let withEvidence = 0
let totalItems = 0
const byKind: Record<string, number> = {}

for (const r of rows) {
  const ev = await gatherEvidence({ kind: r.kind, recordId: r.id })
  if (ev.error) {
    console.log(`ERROR  ${r.kind} ${r.name}: ${ev.error}`)
    continue
  }
  for (const i of ev.items) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1
  totalItems += ev.items.length
  if (ev.items.length > 0) withEvidence += 1
  const chars = ev.items.reduce((n, i) => n + i.text.length, 0)
  console.log(
    `${ev.items.length.toString().padStart(3)} items ${String(chars).padStart(6)} chars` +
      `${ev.truncatedItems ? ` (+${ev.truncatedItems} dropped)` : ''}` +
      `  ${r.conf ? '[CONFIDENTIAL] ' : ''}${r.kind}: ${r.name}` +
      `  newest=${ev.newestAt?.slice(0, 10) ?? 'none'}`
  )
}

console.log('')
console.log(`records: ${rows.length}  with evidence: ${withEvidence}  items: ${totalItems}`)
console.log('by kind:', byKind)
