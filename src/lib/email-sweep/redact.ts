/**
 * Discard the text of a LOCAL conversation the model judged not work-related.
 *
 * ⚠ TWO DIFFERENT QUESTIONS, AND ONLY ONE OF THEM IS ANSWERABLE UP FRONT.
 * Whether a CONVERSATION is business can be decided deterministically before
 * anything is read (imessage/classify.ts, and Richard's rule of 10-11).
 * Whether a particular DAY of that conversation is business cannot — the people
 * who run a company by text also arrange dinner on the same thread. So a
 * session is admitted on the conversation's merits, read once by the model, and
 * then either kept or forgotten.
 *
 * ⚠ IT COVERS EVERY LOCAL SOURCE, AND THAT IS WHAT MOVED IT HERE FROM
 * `imessage/redact.ts` (10-14). Voice Memos is read WITHOUT a nominated folder
 * — every memo, by Richard's decision, in exchange for zero taps on the phone —
 * and this pass is the entire reason that is safe: a memo is transcribed, the
 * summarizer judges it, and a `noise` verdict means the transcript never
 * existed. A filter that only knew about `imessage:` would have left a personal
 * recording's words in `raw_markdown`, searchable by /api/thread-links, forever.
 * §12 — a security filter belongs at the choke point as a DEFAULT, not as a
 * parameter every caller passes.
 *
 * ⚠ MAIL IS DELIBERATELY NOT IN SCOPE. A noise email stays readable: it arrived
 * at a company mailbox, it is a business record whether or not it is a DEAL
 * record, and nobody's private life is in `moose@`'s inbox the way it is in
 * their Messages or their voice memos. The prefixes name exactly what this
 * reaches.
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
 * fingerprint and its verdict, so the session is never read twice. For a voice
 * memo it does one more job: the sweep's "already seen" check is that
 * fingerprint, so a discarded memo is never re-transcribed either.
 *
 * What is kept is deliberately thin: `relevance` so the discard is countable
 * and the filter auditable, and nothing else. The model's prose summary goes
 * too — "casual personal text exchange regarding weekend plans" is harmless,
 * but a one-line description of a private conversation is still a description
 * of a private conversation, and the next one might be medical.
 */

import { sweepDb } from '@/lib/email-sweep/db'
import { LOCAL_THREAD_PREFIXES } from '@/lib/email-sweep/thread-source'
import { isVoiceMemoThread } from '@/lib/voicememos/to-thread'

/** What a redacted row says in place of its text. */
export const REDACTED_NOTE = 'private — not work-related, text discarded after classification'

export interface RedactResult {
  redacted: number
  chunksRemoved: number
  /** Audio files deleted for discarded recordings. */
  audioDiscarded: number
  /**
   * Recordings whose audio could not even be NAMED, so it was neither deleted
   * nor skip-listed. Never zero by assumption — see `voicememos/discard.ts`.
   */
  audioUnresolved: number
}

/**
 * Forget every admitted local conversation the model called noise.
 *
 * Idempotent: a row already redacted has no `raw_markdown` to find. Safe to
 * call after every summarize pass and again from a sweep as a backstop, which
 * is what reaches sessions summarized before this existed.
 */
export async function redactPrivateLocalThreads(threadIds?: string[]): Promise<RedactResult> {
  const db = sweepDb()

  let q = db
    .from('email_threads')
    .select('id, gmail_thread_id')
    // ⚠ Quoted values, and the prefixes are source constants rather than
    // anything a caller supplies — §12: `.or()` takes a logic tree, an
    // unescaped comma kills the query and unquoted parentheses return an empty
    // set with no error at all.
    .or(LOCAL_THREAD_PREFIXES.map((p) => `gmail_thread_id.like."${p}%"`).join(','))
    .eq('summary_state', 'summarized')
    .not('raw_markdown', 'is', null)
    // ->> rather than a cast: §12 forbids `::` inside a PostgREST filter.
    .eq('summary->>relevance', 'noise')
  if (threadIds?.length) q = q.in('id', threadIds)

  const { data, error } = await q
  if (error) throw new Error(`Could not find private local threads: ${error.message}`)
  const rows = (data ?? []) as { id: string; gmail_thread_id: string | null }[]
  if (rows.length === 0)
    return { redacted: 0, chunksRemoved: 0, audioDiscarded: 0, audioUnresolved: 0 }
  const ids = rows.map((r) => r.id)

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

  // ── And for a recording, the AUDIO, which no other source has ─────────────
  //
  // ⚠ NULLING THE TEXT IS NOT ENOUGH WHEN THE SOURCE IS SOUND. The transcript
  // was the derivative; the m4a `bw-snapshot` copied into a directory this
  // process can read is the original, and leaving it there is exactly the
  // blast-radius widening the snapshot binary refuses for the Notes media tree
  // ("copying a personal photo library into a directory the app CAN read").
  // Non-fatal: the text is already gone, which is the part that could answer a
  // question out loud.
  const memoIds = rows
    .map((r) => r.gmail_thread_id)
    .filter((id): id is string => isVoiceMemoThread(id))
  let audioDiscarded = 0
  let audioUnresolved = 0
  if (memoIds.length > 0) {
    try {
      const { discardMemoAudio } = await import('@/lib/voicememos/discard')
      const discarded = await discardMemoAudio(memoIds)
      audioDiscarded = discarded.deleted
      audioUnresolved = discarded.unresolved
    } catch (err) {
      console.error(
        '[sweep/redact] could not discard recording audio:',
        err instanceof Error ? err.message : err
      )
      audioUnresolved = memoIds.length
    }
  }

  return {
    redacted: ids.length,
    chunksRemoved: chunksRemoved ?? 0,
    audioDiscarded,
    audioUnresolved,
  }
}
