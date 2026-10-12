/** Read-only: what the board will look like, by tier. */
import { createAdminClient } from '@/lib/supabase/admin'
import { loadLiveContext, taskTier, tierRank } from '@/lib/tasks/priority'

const live = await loadLiveContext()
const { data } = await createAdminClient()
  .from('tasks')
  .select('title, due_date, status, project_id, opportunity_id, investor_id, objective_id, commitment_id')
  .eq('status', 'open')

const today = new Date().toISOString().slice(0, 10)
const rows = (data ?? []).map((t) => ({
  tier: taskTier(t, live),
  overdue: !!t.due_date && t.due_date < today,
  title: t.title,
}))

const counts = new Map<string, number>()
for (const r of rows) counts.set(r.tier, (counts.get(r.tier) ?? 0) + 1)
console.log('open tasks by tier:', Object.fromEntries(counts), '| overdue:', rows.filter((r) => r.overdue).length)

rows.sort((a, b) =>
  (a.overdue ? -1 : tierRank(a.tier)) - (b.overdue ? -1 : tierRank(b.tier))
)
console.log('\ntop of the board as the reader will see it:')
for (const r of rows.slice(0, 12)) {
  console.log(` ${r.overdue ? 'OVERDUE' : r.tier.padEnd(10)} · ${r.title.slice(0, 62)}`)
}
console.log('\nbottom:')
for (const r of rows.slice(-4)) console.log(` ${r.tier.padEnd(10)} · ${r.title.slice(0, 62)}`)
