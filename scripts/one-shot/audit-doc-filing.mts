/** Read-only: do project/opportunity-filed documents agree with the router? */
import { createAdminClient } from '@/lib/supabase/admin'
import { bestMatch, loadTargets } from '@/lib/email-sweep/route-phase'

const supabase = createAdminClient()
const targets = await loadTargets()

type Row = {
  id: string; file_name: string; ai_summary: string | null; doc_type: string | null
  project_id: string | null; drive_folder_path: string | null; filing_confirmed_at: string | null
}
const { data: proj } = await supabase.from('documents')
  .select('id, file_name, ai_summary, doc_type, project_id, drive_folder_path, filing_confirmed_at')
  .not('project_id', 'is', null).is('superseded_at', null).is('excluded_at', null)
const { data: opps } = await supabase.from('opportunity_documents')
  .select('id, file_name, ai_summary, doc_type, opportunity_id, drive_folder_path, filing_confirmed_at')
  .not('opportunity_id', 'is', null).is('superseded_at', null).is('excluded_at', null)

const byId = new Map(targets.map((t) => [`${t.kind}:${t.id}`, t.name]))
const items = [
  ...((proj ?? []) as Row[]).map((r) => ({ ...r, kind: 'project' as const, recId: r.project_id! })),
  ...((opps ?? []) as unknown as Array<Row & { opportunity_id: string }>).map((r) => ({
    ...r, kind: 'opportunity' as const, recId: r.opportunity_id })),
]

let agree = 0, noMatch = 0, disagree = 0, confirmed = 0
const rows: string[] = []
for (const it of items) {
  if (it.filing_confirmed_at) { confirmed++; continue }
  const name = [it.file_name, it.doc_type].filter(Boolean).join(' — ')
  const summary = { deal_name: name, summary: it.ai_summary ?? '' } as never
  const m = bestMatch(name, summary, [], targets)
  if (!m) { noMatch++; continue }
  if (m.target.kind === it.kind && m.target.id === it.recId) { agree++; continue }
  disagree++
  rows.push([
    (byId.get(`${it.kind}:${it.recId}`) ?? it.recId).slice(0, 34).padEnd(34),
    (m.target.name).slice(0, 30).padEnd(30),
    m.confidence.toFixed(2),
    it.file_name.slice(0, 54),
  ].join(' | '))
}
console.log({ total: items.length, confirmed, agree, noMatch, disagree })
console.log('\nSITS ON'.padEnd(35) + '| ROUTER SAYS'.padEnd(32) + '| CONF | FILE')
rows.sort().slice(0, 60).forEach((r) => console.log(r))
console.log(`\n(${rows.length} disagreements total)`)
