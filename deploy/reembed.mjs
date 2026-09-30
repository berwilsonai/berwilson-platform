/**
 * Full re-embed of BOTH vector indexes.
 *
 * Run this whenever the embedding model or EMBEDDING_DIMS changes. Every stored
 * vector is only meaningful against the model AND the width that produced it, so
 * a change to either invalidates the whole index — there is no incremental path.
 *
 * Usage (repo root, on the Studio):
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local deploy/reembed.mjs [--chunks-only|--threads-only]
 *        [--no-attachments]
 *
 * ⚠ UNLOAD THE CHAT MODEL FIRST (`lms unload qwen/qwen3.6-35b-a3b`). The 35B holds
 * ~25GB wired on a 36GB box; the 639MB embedder then gets the whole machine and the
 * pass runs without paging. Reload it afterwards at the documented settings
 * (`deploy/lmstudio-check.sh` asserts them).
 *
 * ⚠ RETRIEVAL IS DOWN between the wipe and the refill. Ber AI will answer "no
 * correspondence found" until this finishes. Run it in the 19:00–04:00 idle window.
 *
 * History — 2026-09-30: this script covered `chunks` ONLY. It never touched
 * `thread_chunks` (the entire correspondence index, 6,498 rows), nor the investor,
 * party-enrichment or research-report chunks inside `chunks` itself, and it did not
 * filter superseded documents — so it would have ADDED 12 retired duplicates to an
 * index that deliberately held none. A re-embed tool that misses an index is worse
 * than none: it leaves two incompatible vector spaces in one table and reports
 * success. The phase counts below exist so a partial run is visible.
 */

import { createClient } from '@supabase/supabase-js'
import {
  embedUpdate,
  embedDocument,
  embedOpportunitySnapshot,
  embedOpportunityNote,
  embedOpportunityDocument,
  embedOpportunityReport,
  embedInvestorSnapshot,
  embedEntityEnrichment,
  embedPartyEnrichment,
} from '@/lib/ai/embeddings'
import { EMBEDDING_DIMS, localEmbeddingModel, localEmbedding } from '@/lib/ai/local'
import { embedPendingThreads } from '@/lib/ai/thread-embeddings'
import { sweepDb } from '@/lib/email-sweep/db'

const args = process.argv.slice(2)
const doChunks = !args.includes('--threads-only')
const doThreads = !args.includes('--chunks-only')
const includeAttachments = !args.includes('--no-attachments')

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ---------------------------------------------------------------------------
// Pre-flight. A width mismatch here is the half-migration this script exists to
// avoid, and it is far cheaper to catch before the wipe than after.
// ---------------------------------------------------------------------------
const probe = await localEmbedding('preflight')
log(`embedder: ${localEmbeddingModel()} → ${probe.length} dims stored as ${EMBEDDING_DIMS}`)
if (probe.length < EMBEDDING_DIMS) {
  throw new Error(`embedder returns ${probe.length} dims, schema needs ${EMBEDDING_DIMS} — wrong model loaded?`)
}
if (probe.length > EMBEDDING_DIMS) {
  log(`⚠ truncating ${probe.length} → ${EMBEDDING_DIMS} (MRL). Native width would be more accurate.`)
}

const before = {
  chunks: (await admin.from('chunks').select('*', { count: 'exact', head: true })).count,
  threadChunks: (await sweepDb().from('thread_chunks').select('id', { count: 'exact', head: true })).count,
}
log(`before: chunks=${before.chunks} thread_chunks=${before.threadChunks}`)

/**
 * Every select goes through here.
 *
 * The 2026-09-30 run caught this script selecting `summary` from `documents`,
 * where the column is `ai_summary` — a 42703 that supabase-js hands back on
 * `error` and the old code never destructured. So the phase read `documents: 0/0`
 * and the run reported success having indexed NO DOCUMENT AT ALL. A zero that
 * came from a broken query and a zero that means an empty table are the same
 * number on screen; only checking the error tells them apart.
 */
const PAGE = 500
const sel = async (table, build) => {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(`select ${table} failed: ${error.message} (${error.code ?? '?'})`)
    rows.push(...(data ?? []))
    // PostgREST caps a response at 1000 rows and says nothing, so a re-embed that
    // reads in one shot silently stops covering the corpus the moment it grows
    // past the cap — and reports a clean total (§12). Paged, it cannot.
    if (!data || data.length < PAGE) return rows
  }
}

// Counted per phase so "it ran" and "it covered the corpus" are different claims.
const phases = {}
const run = async (name, total, fn) => {
  let ok = 0, skipped = 0, failed = 0
  for (const row of total) {
    try {
      // fn returns false for "nothing to embed" (no extracted text and no summary),
      // which is a correct outcome, not a miss. Folding the two into one number
      // makes a real failure indistinguishable from an empty scan (§12).
      if (await fn(row) === false) skipped++
      else ok++
    } catch (err) {
      failed++
      console.error(`  [${name}] ${row.id ?? '?'} failed:`, err.message)
    }
  }
  const detail = `${ok}/${total.length}` +
    (skipped ? ` (${skipped} skipped: no text)` : '') +
    (failed ? ` ⚠ ${failed} FAILED` : '')
  phases[name] = detail
  log(`${name}: ${detail}`)
}

// ---------------------------------------------------------------------------
// chunks — curated CRM records
// ---------------------------------------------------------------------------
if (doChunks) {
  log('wiping chunks...')
  const { error: delErr, count } = await admin.from('chunks').delete({ count: 'exact' }).gte('chunk_index', -1)
  if (delErr) throw delErr
  log(`deleted ${count} chunks`)

  // superseded_at is null — §12: the graveyard is deliberately unindexed. Without
  // this filter the re-embed ADDS 12 retired duplicates whose live twins are here.
  const docs = await sel('documents', () => admin
    .from('documents')
    .select('id, project_id, entity_id, is_company, extracted_text, ai_summary')
    .is('superseded_at', null))
  await run('documents', docs, async (d) => {
    const text = d.extracted_text || d.ai_summary
    if (!text) return false
    await embedDocument(d.id, d.project_id, text, d.entity_id, d.is_company === true)
  })

  const ups = await sel('updates', () =>
    admin.from('updates').select('id, project_id, raw_content').not('raw_content', 'is', null))
  await run('updates', ups, async (u) => {
    if (!u.raw_content?.trim()) return false
    await embedUpdate(u.id, u.project_id, u.raw_content)
  })

  const opps = await sel('opportunities', () => admin.from('opportunities').select('id'))
  await run('opportunity snapshots', opps, (o) => embedOpportunitySnapshot(o.id))

  const notes = await sel('opportunity_notes', () => admin.from('opportunity_notes').select('id, opportunity_id, body, author'))
  await run('opportunity notes', notes, (n) => embedOpportunityNote(n.opportunity_id, n.body, n.author))

  const oppDocs = await sel('opportunity_documents', () => admin
    .from('opportunity_documents')
    .select('id, opportunity_id, extracted_text, ai_summary')
    .is('superseded_at', null))
  await run('opportunity documents', oppDocs, async (d) => {
    const text = d.extracted_text || d.ai_summary
    if (!text) return false
    await embedOpportunityDocument(d.id, d.opportunity_id, text)
  })

  // Research reports (source_type 'email_research_report'). The text is not on a
  // record — it is the confirmed intake session's raw_text, which is why this was
  // missing. created_record_ids carries the opportunity it was filed against.
  const sessions = await sel('email_intake_sessions', () => admin
    .from('email_intake_sessions')
    .select('id, raw_text, created_record_ids')
    .eq('status', 'confirmed'))
  const reports = sessions.filter((s) => s.created_record_ids?.opportunity_id && s.raw_text?.trim())
  await run('research reports', reports, (s) =>
    embedOpportunityReport(s.created_record_ids.opportunity_id, s.raw_text)
  )

  const investors = await sel('investors', () => admin.from('investors').select('id'))
  await run('investor snapshots', investors, (i) => embedInvestorSnapshot(i.id))

  // Enrichment only. embedPartyEnrichment/embedEntityEnrichment will happily
  // serialize a bare name, which would index all 87 contacts as one-line chunks
  // and dilute retrieval — these phases restore what enrichment produced.
  const parties = await sel('parties', () => admin
    .from('parties')
    .select('id')
    .or('enrichment_notes.not.is.null,government_contract_history.not.is.null'))
  await run('party enrichment', parties, (p) => embedPartyEnrichment(p.id))

  const entities = await sel('entities', () => admin
    .from('entities')
    .select('id')
    .or('enrichment_data.not.is.null,description.not.is.null'))
  await run('entity enrichment', entities, (e) => embedEntityEnrichment(e.id))
}

// ---------------------------------------------------------------------------
// thread_chunks — the correspondence index.
//
// Reuses embedPendingThreads, which selects on email_threads.embedded_at is null
// and stamps each thread as it completes. So resetting the cursor IS the whole
// re-embed trigger, and killing this mid-run costs at most the thread in flight.
// ---------------------------------------------------------------------------
if (doThreads) {
  const db = sweepDb()
  log('wiping thread_chunks...')
  const { error: tDelErr } = await db.from('thread_chunks').delete().not('id', 'is', null)
  if (tDelErr) throw tDelErr
  const { error: curErr } = await db
    .from('email_threads')
    .update({ embedded_at: null })
    .not('embedded_at', 'is', null)
  if (curErr) throw curErr
  log(`cursor reset (attachments ${includeAttachments ? 'ON' : 'OFF'})`)

  const total = { processed: 0, bodyChunks: 0, attachmentChunks: 0, skipped: 0, failed: 0 }
  for (;;) {
    const p = await embedPendingThreads({ limit: 50, budgetMs: 30 * 60 * 1000, includeAttachments })
    if (p.processed === 0) break
    total.processed += p.processed
    total.bodyChunks += p.bodyChunks
    total.attachmentChunks += p.attachmentChunks
    total.skipped += p.skipped
    total.failed += p.failed
    log(`+${p.processed} threads (${p.bodyChunks} body, ${p.attachmentChunks} attachment) — ${p.remaining} left`)
  }
  phases.threads = `${total.processed} threads, ${total.bodyChunks + total.attachmentChunks} chunks, ${total.skipped} skipped, ${total.failed} failed`
  log(`threads: ${phases.threads}`)
}

// ---------------------------------------------------------------------------
// Report. A bare total cannot tell a finished run from a half one.
// ---------------------------------------------------------------------------
const after = {
  chunks: (await admin.from('chunks').select('*', { count: 'exact', head: true })).count,
  threadChunks: (await sweepDb().from('thread_chunks').select('id', { count: 'exact', head: true })).count,
}
console.log('\n--- re-embed complete ---')
for (const [k, v] of Object.entries(phases)) console.log(`  ${k}: ${v}`)
console.log(`  chunks:        ${before.chunks} -> ${after.chunks}`)
console.log(`  thread_chunks: ${before.threadChunks} -> ${after.threadChunks}`)
if (doChunks && after.chunks < before.chunks * 0.9) {
  console.log(`\n⚠ chunks came back >10% SHORT. Check the per-phase failures above before trusting retrieval.`)
}
if (doThreads && after.threadChunks < before.threadChunks * 0.9) {
  console.log(`\n⚠ thread_chunks came back >10% SHORT — re-run to resume (the cursor makes it safe).`)
}
