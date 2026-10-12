/** Read-only: does loadLiveContext agree with the database? */
import { loadLiveContext } from '@/lib/tasks/priority'
import { createAdminClient } from '@/lib/supabase/admin'

const live = await loadLiveContext()
console.log('error:', live.error)
console.log('live records:', live.liveRecordIds.size, '| live commitments:', live.liveCommitmentIds.size)

const db = createAdminClient()
const [{ data: projects }, { data: opps }] = await Promise.all([
  db.from('projects').select('id, name'),
  db.from('opportunities').select('id, name'),
])
const names = new Map<string, string>()
for (const r of [...(projects ?? []), ...(opps ?? [])]) names.set(r.id, r.name)
console.log('\nrecords counted as live:')
for (const id of live.liveRecordIds) console.log(' -', names.get(id) ?? `(not a project/opportunity: ${id})`)
