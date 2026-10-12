/**
 * Discard the text of a text conversation the model judged not work-related.
 *
 * ⚠ TWO DIFFERENT QUESTIONS, AND ONLY ONE OF THEM IS ANSWERABLE UP FRONT.
 * Whether a CONVERSATION is business can be decided deterministically before
 * anything is read (classify.ts, and Richard's rule of 10-11). Whether a
 * particular DAY of that conversation is business cannot — the people who run
 * a company by text also arrange dinner on the same thread. So a session is
 * admitted on the conversation's merits, read once by the model, and then
 * either kept or forgotten.
 *
 * ⚠ NULLING `raw_markdown` IS THE WHOLE MECHANISM, AND IT IS A CHOKE POINT.
 * Four separate things read that column — the keyword search behind
 * /api/thread-links, commitment extraction, People Intake's profile builder,
 * and lead triage. Filtering each of them would be four places to forget. The
 * text simply stops existing, so every reader present and future is covered.
 *
 * ⚠ THE ROW IS THE TOMBSTONE (§12). Deleting it would have the next sweep
 * re-ingest the same conversation, re-summarize it at 30-60s of local model,
 * and forget it again — nightly, forever. The row survives carrying its
 * fingerprint and its verdict, so the session is never read twice.
 *
 * What is kept is deliberately thin: `relevance` so the discard is countable
 * and the filter auditable, and nothing else. The model's prose summary goes
 * too — "casual personal text exchange regarding weekend plans" is harmless,
 * but a one-line description of a private conversation is still a description
 * of a private conversation, and the next one might be medical.
 */

import { sweepDb } from '@/lib/email-sweep/db'
import { IMESSAGE_THREAD_PREFIX } from './to-thread'

/** What a redacted row says in place of its text. */
export const REDACTED_NOTE = 'private — not work-related, text discarded after classification'

export interface RedactResult {
  redacted: number
  chunksRemoved: number
}

/**
 * Forget every admitted text session the model called noise.
 *
 * Idempotent: a row already redacted has no `raw_markdown` to find. Safe to
 * call after every summarize pass and again from the sweep as a backstop, which
 * is what reaches sessions summarized before this existed.
 */
export async function redactPrivateTexts(threadIds?: string[]): Promise<RedactResult> {
  const db = sweepDb()

  let q = db
    .from('email_threads')
    .select('id')
    .like('gmail_thread_id', `${IMESSAGE_THREAD_PREFIX}%`)
    .eq('summary_state', 'summarized')
    .not('raw_markdown', 'is', null)
    // ->> rather than a cast: §12 forbids `::` inside a PostgREST filter.
    .eq('summary->>relevance', 'noise')
  if (threadIds?.length) q = q.in('id', threadIds)

  const { data, error } = await q
  if (error) throw new Error(`Could not find private text sessions: ${error.message}`)
  const ids = (data ?? []).map((r) => (r as { id: string }).id)
  if (ids.length === 0) return { redacted: 0, chunksRemoved: 0 }

  // Chunks first: `thread_chunks` is what retrieval reads, so it is the half
  // that can answer a question out loud. A noise thread should never have been
  // embedded (the embed phase skips it), so a non-zero count here is worth
  // knowing about rather than silently cleaning.
  const { count: chunksRemoved } = await db
    .from('thread_chunks')
    .delete({ count: 'exact' })
    .in('thread_id', ids)

  const { error: updErr } = await db
    .from('email_threads')
    .update({
      raw_markdown: null,
      summary: { relevance: 'noise' },
      summary_error: REDACTED_NOTE,
    })
    .in('id', ids)
  if (updErr) throw new Error(`Could not discard private text: ${updErr.message}`)

  return { redacted: ids.length, chunksRemoved: chunksRemoved ?? 0 }
}
