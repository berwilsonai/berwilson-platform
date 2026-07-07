import { createClient } from '@supabase/supabase-js'
import { embedUpdate, embedDocument, embedOpportunitySnapshot, embedOpportunityNote, embedOpportunityDocument } from './src/lib/ai/embeddings.ts'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

console.log('wiping chunks...')
const { error: delErr, count } = await admin.from('chunks').delete({ count: 'exact' }).gte('chunk_index', -1)
if (delErr) throw delErr
console.log(`deleted ${count} chunks`)

const { data: docs } = await admin.from('documents').select('id, project_id, entity_id, is_company, extracted_text, summary')
let dOk = 0
for (const d of docs ?? []) {
  const text = d.extracted_text || d.summary
  if (!text) continue
  await embedDocument(d.id, d.project_id, text, d.entity_id, d.is_company === true)
  dOk++
}
console.log(`documents embedded: ${dOk}/${docs?.length}`)

const { data: ups } = await admin.from('updates').select('id, project_id, raw_content').not('raw_content', 'is', null)
let uOk = 0
for (const u of ups ?? []) {
  if (!u.raw_content?.trim()) continue
  await embedUpdate(u.id, u.project_id, u.raw_content)
  uOk++
}
console.log(`updates embedded: ${uOk}/${ups?.length}`)

const { data: opps } = await admin.from('opportunities').select('id')
for (const o of opps ?? []) await embedOpportunitySnapshot(o.id)
console.log(`opportunity snapshots: ${opps?.length}`)

const { data: notes } = await admin.from('opportunity_notes').select('opportunity_id, body, author')
for (const n of notes ?? []) await embedOpportunityNote(n.opportunity_id, n.body, n.author)
console.log(`opportunity notes: ${notes?.length}`)

const { data: oppDocs } = await admin.from('opportunity_documents').select('id, opportunity_id, extracted_text, summary')
let odOk = 0
for (const d of oppDocs ?? []) {
  const text = d.extracted_text || d.summary
  if (!text) continue
  await embedOpportunityDocument(d.id, d.opportunity_id, text)
  odOk++
}
console.log(`opportunity documents embedded: ${odOk}/${oppDocs?.length}`)

const { count: final } = await admin.from('chunks').select('*', { count: 'exact', head: true })
console.log(`FINAL chunk count: ${final}`)
