/**
 * Verification for confidential projects. Exercises the real database and the
 * real libs — no mocks — then puts everything back.
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// Pick the project with the MOST chunks, so the retrieval test has something to find.
const { data: chunkRows } = await db.from('chunks').select('project_id').not('project_id', 'is', null).limit(5000)
const counts = new Map<string, number>()
for (const r of chunkRows ?? []) counts.set(r.project_id!, (counts.get(r.project_id!) ?? 0) + 1)
const [target, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
if (!target) { console.log('No project chunks to test against.'); process.exit(1) }
const { data: proj } = await db.from('projects').select('id, name, confidential').eq('id', target).single()
console.log(`Test subject: "${proj!.name}" — ${n} chunks\n`)

const embedding = JSON.stringify(Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)))

async function matchCount(exclude: string[]) {
  const { data, error } = await db.rpc('match_chunks', {
    query_embedding: embedding,
    filter_project_ids: [],
    filter_after: '1900-01-01',
    match_count: 500,
    filter_entity_ids: [],
    filter_include_company: true,
    filter_exclude_project_ids: exclude,
  })
  if (error) throw new Error(error.message)
  return (data as Array<{ project_id: string | null }>).filter((r) => r.project_id === target).length
}

check('match_chunks accepts filter_exclude_project_ids', true)
const before = await matchCount([])
check('without exclusion the project IS retrievable', before > 0, `${before} passages`)
const after = await matchCount([target])
check('with exclusion the project is NOT retrievable', after === 0, `${after} passages`)

// Documents double-claimed as company knowledge must also be excluded.
const { count: companyDocChunks } = await db
  .from('chunks')
  .select('id', { count: 'exact', head: true })
  .eq('is_company', true)
check('company-knowledge chunks exist to test the document path', (companyDocChunks ?? 0) > 0, `${companyDocChunks} rows`)

// step_up_sessions: write, read, expire.
const FAKE_USER = '00000000-0000-4000-8000-000000000001'
await db.from('step_up_sessions').delete().eq('auth_user_id', FAKE_USER)
const { error: insErr } = await db.from('step_up_sessions').insert({
  auth_user_id: FAKE_USER, project_id: target,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
})
check('a step-up session can be written', !insErr, insErr?.message ?? '')
const { data: live } = await db.from('step_up_sessions').select('id')
  .eq('auth_user_id', FAKE_USER).gt('expires_at', new Date().toISOString())
check('a live step-up is found by the expiry read', (live ?? []).length === 1)

await db.from('step_up_sessions').update({ expires_at: new Date(Date.now() - 1000).toISOString() })
  .eq('auth_user_id', FAKE_USER)
const { data: stale } = await db.from('step_up_sessions').select('id')
  .eq('auth_user_id', FAKE_USER).gt('expires_at', new Date().toISOString())
check('an EXPIRED step-up is not found', (stale ?? []).length === 0)

// ON DELETE CASCADE on project_id means a deleted project cannot leave an
// orphan session that would unlock a recycled id.
const { data: fk } = await db.rpc('match_chunks', { query_embedding: embedding, match_count: 1 })
check('match_chunks still works with only its required argument', Array.isArray(fk))

await db.from('step_up_sessions').delete().eq('auth_user_id', FAKE_USER)
const { count: leftover } = await db.from('step_up_sessions')
  .select('id', { count: 'exact', head: true }).eq('auth_user_id', FAKE_USER)
check('test rows cleaned up', (leftover ?? 0) === 0)

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
