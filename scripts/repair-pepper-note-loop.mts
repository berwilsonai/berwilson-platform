/**
 * One-off repair: remove what the platform extracted from its own morning notes.
 *
 * WHAT HAPPENED. `prefilter.ts` has always held a self-loop guard —
 * `isPlatformMail` — that skips a thread the platform wrote every message of.
 * It recognised the sender by display name (`PLATFORM_SENDER_NAME`, 'Ber
 * Intelligence'). On 2026-09-24 Pepper's note began sending as *Pepper
 * <info@berwilson.com>*, deliberately and for a good reason, and that walked
 * straight through the guard.
 *
 * Measured 2026-10-09: **131 of 481 open commitments — 27% of the ledger — were
 * extracted from Pepper's own notes**, across 24 note threads, compounding every
 * morning because each note listed the previous morning's harvest. 40 chunks of
 * her notes were also in the retrieval index, where Ber AI could cite a summary
 * of a summary as evidence about a deal.
 *
 * The guard is fixed (the assistant seat's ADDRESS is now sufficient, so no
 * future display name can reopen it). This clears what the gap already let in.
 *
 * ⚠ IDENTIFICATION IS BY SUBJECT, AND THE "MORE ROBUST" PREDICATE WAS WRONG.
 * A structural test — participants are only the assistant seat plus internal
 * mailboxes — looked better and caught **9 real threads**: a forwarded stairs
 * proposal, an IDIQ template, the FORT Polk contract, a Helper risk analysis.
 * Those are genuine correspondence forwarded between the executives, and
 * dismissing their commitments would have destroyed real obligations. The
 * subject predicate finds 24 threads, every one a single-message note from the
 * seat with a commitment count for a subject; all 24 were read by eye.
 *
 * Dry by default. `--apply` writes, and always writes the snapshot first.
 */

import { writeFileSync } from 'node:fs'
import { sweepDb } from '@/lib/email-sweep/db'

const APPLY = process.argv.includes('--apply')

/** Matches the subject Pepper's own note renders. See the header on why. */
const NOTE_SUBJECT =
  /commitments? outstanding|overdue — and|decisions waiting on you|^Your morning note$/

/** What the repaired prefilter writes, so a repaired row is indistinguishable. */
const SKIP_REASON = 'Written by the platform (no human message on the thread)'

const SETTLED_BY = 'self-loop repair — extracted from Pepper’s own note (2026-10-09)'

async function pageAll<T>(
  run: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  // ⚠ PostgREST truncates at 1000 rows SILENTLY (§12). A bare .limit(5000)
  // while investigating this very bug saw 8 of 24 note threads and
  // under-reported the loop five-fold.
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run(from, from + 999)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    out.push(...batch)
    if (batch.length < 1000) break
  }
  return out
}

async function main() {
  const db = sweepDb()

  const threads = await pageAll<{ id: string; subject: string | null; participants: string[] | null; summary_state: string | null }>(
    (from, to) => db.from('email_threads').select('id, subject, participants, summary_state').range(from, to)
  )
  const notes = threads.filter((t) => NOTE_SUBJECT.test(t.subject ?? ''))
  console.log(`threads read: ${threads.length}`)
  console.log(`Pepper's own notes: ${notes.length}`)

  const noteIds = new Set(notes.map((t) => t.id))

  const commitments = await pageAll<Record<string, unknown>>((from, to) =>
    db.from('commitments').select('*').eq('status', 'open').range(from, to)
  )
  const doomed = commitments.filter((c) => noteIds.has(c.thread_id as string))
  console.log(`open commitments: ${commitments.length}`)
  console.log(`  from those notes: ${doomed.length}`)
  console.log(`  from real correspondence (untouched): ${commitments.length - doomed.length}`)

  const chunks = await pageAll<{ id: string; thread_id: string }>((from, to) =>
    db.from('thread_chunks').select('id, thread_id').in('thread_id', [...noteIds]).range(from, to)
  )
  console.log(`note chunks in the retrieval index: ${chunks.length}`)

  const stillSummarized = notes.filter((t) => t.summary_state !== 'skipped')
  console.log(`note threads not yet marked skipped: ${stillSummarized.length}`)

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.')
    console.log('\nSample of what would be dismissed:')
    for (const c of doomed.slice(0, 8)) console.log(`   [${c.side}] ${String(c.what).slice(0, 78)}`)
    return
  }

  // ⚠ SNAPSHOT BEFORE THE FIRST WRITE. `open` is the undo for a commitment, but
  // only if the row is still identifiable afterwards — and a backup is not a
  // backup until it can be read back, with seconds in the filename so a retry
  // in the same minute cannot overwrite the good copy (§12).
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = `/Users/richardwhite/berwilson-data/repairs/pepper-note-loop-${stamp}.json`
  writeFileSync(
    path,
    JSON.stringify(
      { takenAt: new Date().toISOString(), noteThreads: notes, commitments: doomed, chunks },
      null,
      2
    )
  )
  console.log(`\nsnapshot: ${path}`)

  let dismissed = 0
  for (const c of doomed) {
    const { error } = await db
      .from('commitments')
      .update({
        status: 'dismissed',
        settled_at: new Date().toISOString(),
        settled_by: SETTLED_BY,
        snoozed_until: null,
      })
      .eq('id', c.id as string)
      .eq('status', 'open') // never overwrite a verdict a human reached meanwhile
    if (error) console.error(`  ! ${c.id}: ${error.message}`)
    else dismissed++
  }
  console.log(`dismissed: ${dismissed}/${doomed.length}`)

  if (chunks.length > 0) {
    const { error } = await db.from('thread_chunks').delete().in('thread_id', [...noteIds])
    console.log(error ? `  ! chunks: ${error.message}` : `chunks removed: ${chunks.length}`)
  }

  // Marked exactly as the repaired prefilter would, so these threads are out of
  // summarization, clustering, embedding AND commitment extraction — the last
  // of which is gated on summary_state='summarized'.
  const { error: tErr } = await db
    .from('email_threads')
    .update({ summary_state: 'skipped', summary_error: SKIP_REASON })
    .in('id', [...noteIds])
  console.log(tErr ? `  ! threads: ${tErr.message}` : `note threads marked skipped: ${notes.length}`)
}

main().then(
  () => process.exit(0),
  (err) => {
    // Catch, name what threw, THEN exit — a `finally` calling process.exit
    // swallows the throw it is unwinding (§12).
    console.error('REPAIR FAILED:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
)
