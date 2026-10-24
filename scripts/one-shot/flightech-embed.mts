/**
 * Index the imported delegation contacts so Ber AI can answer about them.
 *
 * ⚠ RUN WITH THE CHAT MODEL UNLOADED (§12 — `lms unload` drops wired memory
 * 25.4GB → 4.3GB, and this box was down to ~100MB free with 17.6GB of swap in
 * use when the import landed). The embedder is 639MB and is all this needs.
 *
 * `embedPartyEnrichment` deletes its own chunks before writing, so this is
 * idempotent and safe to re-run. It reads `relationship_notes` — which is where
 * the biography lives, and which it did not read until 2026-10-24: a contact
 * whose whole value is their biography was unanswerable before that.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { embedPartyEnrichment } from '@/lib/ai/embeddings'

const TAG = process.env.ROSTER_TAG ?? 'flightech-delegation'
const db = createAdminClient()

const { data: people, error } = await db
  .from('parties')
  .select('id, full_name')
  .contains('tags', [TAG])
  .order('full_name')

// §12: check the error on every select — a zero from a broken query and a zero
// from an empty table are the same value and opposite facts.
if (error) throw new Error(`could not read the roster: ${error.message}`)
if (!people?.length) throw new Error(`no contacts carry the tag "${TAG}" — nothing to index`)

console.log(`indexing ${people.length} contacts tagged "${TAG}"`)

let done = 0
const failed: string[] = []
for (const p of people) {
  try {
    await embedPartyEnrichment(p.id)
    done++
  } catch (err) {
    failed.push(`${p.full_name}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (done % 25 === 0 && done > 0) console.log(`  ${done}/${people.length}`)
}

// Count what actually landed rather than trusting the loop — the embed helper
// swallows its own errors by design so a failed index cannot fail a write.
const ids = people.map((p) => p.id)
let chunks = 0
for (let i = 0; i < ids.length; i += 100) {
  const { count, error: cErr } = await db
    .from('chunks')
    .select('id', { count: 'exact', head: true })
    .in('party_id', ids.slice(i, i + 100))
    .eq('source_type', 'party_enrichment')
  if (cErr) throw new Error(`could not count chunks: ${cErr.message}`)
  chunks += count ?? 0
}

console.log(`\nindexed ${done}/${people.length}`)
console.log(`chunks on those contacts: ${chunks}`)
const without = people.length - Math.min(people.length, chunks)
if (without > 0) console.log(`⚠ ${without} contact(s) have no chunk — they are not retrievable`)
if (failed.length) console.log(`\nFAILED:\n` + failed.map((f) => `  ${f}`).join('\n'))
