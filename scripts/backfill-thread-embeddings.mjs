/**
 * One-off backfill for the correspondence index (2026-09-14).
 *
 * Indexes every swept thread that is not marketing, so Ber AI can answer from
 * what was actually said in email rather than only from curated CRM records.
 *
 * Resumable and idempotent, like scripts/backfill-correspondence.mjs: each
 * thread is stamped embedded_at when done, embedding is delete-and-replace per
 * thread, and killing this mid-run costs at most the thread in flight.
 *
 * Usage (repo root, on the Studio):
 *   node --experimental-strip-types --import ./scripts/register-alias.mjs \
 *        --env-file=.env.local scripts/backfill-thread-embeddings.mjs [--no-attachments]
 *
 * Cost, measured rather than estimated: ~220ms per chunk warm against the local
 * embedding model, ~2.5 chunks per thread body. Attachments dominate when
 * present — a PDF costs its text extraction — which is why they can be skipped.
 */

import { embedPendingThreads } from '@/lib/ai/thread-embeddings'
import { sweepDb } from '@/lib/email-sweep/db'

const includeAttachments = !process.argv.includes('--no-attachments')
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const db = sweepDb()
const { count: todo } = await db
  .from('email_threads')
  .select('id', { count: 'exact', head: true })
  .eq('summary_state', 'summarized')
  .is('embedded_at', null)
  .or('summary->>relevance.is.null,summary->>relevance.neq.noise')

log(`${todo ?? 0} threads to index (attachments ${includeAttachments ? 'ON' : 'OFF'})`)

const total = { processed: 0, bodyChunks: 0, attachmentChunks: 0, skipped: 0, failed: 0 }
for (;;) {
  // A generous budget per pass: this is the backfill, not the hourly cron, and
  // its whole job is to finish. The loop re-enters until nothing is left.
  const p = await embedPendingThreads({
    limit: 50,
    budgetMs: 30 * 60 * 1000,
    includeAttachments,
  })
  if (p.processed === 0) break

  total.processed += p.processed
  total.bodyChunks += p.bodyChunks
  total.attachmentChunks += p.attachmentChunks
  total.skipped += p.skipped
  total.failed += p.failed

  log(
    `+${p.processed} threads (${p.bodyChunks} body, ${p.attachmentChunks} attachment chunks) — ${p.remaining} left`
  )
  if (p.remaining === 0) break
}

log(
  `done: ${total.processed} threads, ${total.bodyChunks} body + ${total.attachmentChunks} attachment chunks, ${total.skipped} skipped, ${total.failed} failed`
)
