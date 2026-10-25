/**
 * Prove the ingestion recovery against the LIVE corpus.
 *
 * Three things `tsc` and the build cannot see, each of which has shipped broken
 * from this repo before:
 *
 *   1. A `.select()` COLUMN LIST IS A STRING (§12). The new orphan selector
 *      embeds `links:thread_links(id)` and reads `attachments_through`; a typo
 *      or a missing grant answers `42703`/`42501` and PostgREST fails the WHOLE
 *      query, which the caller reads as "no threads owed anything" — a silent
 *      zero, the one failure that looks exactly like success.
 *   2. The widened noise gate is a VIEW predicate. Nothing in the suite can see
 *      whether it recovers an attachment-bearing thread and still withholds a
 *      bare notification, so both arms are asserted here against real rows.
 *   3. An EMPTY POPULATION PASSES VACUOUSLY behind the same tick (§12), so
 *      every assertion prints what it examined and refuses a zero population.
 *
 * Read-only. Run it before and after a drain to watch the numbers move:
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *     --env-file=.env.local scripts/verify-ingestion-recovery.mts
 */

import { createAdminClient } from '../src/lib/supabase/admin.ts'

const db = createAdminClient()

let failures = 0
function check(ok: boolean, label: string, detail: string) {
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`)
  console.log(`       ${detail}`)
}

/** Refuses a vacuous pass: an assertion over nothing is not an assertion. */
function population(n: number, label: string): boolean {
  if (n > 0) return true
  failures++
  console.log(` FAIL  ${label}`)
  console.log(`       examined 0 rows — this assertion proved nothing`)
  return false
}

console.log('\n── 1. The orphan selector reads (the string tsc cannot check) ──\n')

{
  // Exactly the select the phase issues. A thrown error or a null `data` here
  // is the whole point of this script.
  const { data, error } = await db
    .from('email_threads')
    .select(
      'id, subject, mailbox, gmail_thread_id, message_count, attachment_count, attachments_through, last_at, links:thread_links(id)'
    )
    .eq('pipeline', 'deal')
    .gt('attachment_count', 0)
    .order('last_at', { ascending: false })
    .limit(1000)

  check(
    !error && Array.isArray(data),
    'the select resolves',
    error ? `PostgREST said: ${error.code} ${error.message}` : `${data?.length ?? 0} rows came back`
  )

  const rows = (data ?? []) as unknown as Array<{
    id: string
    attachments_through: number | null
    message_count: number | null
    attachment_count: number | null
    links: { id: string }[] | null
  }>

  if (population(rows.length, 'the deal-mail-with-files population exists')) {
    // The embed must come back as an ARRAY, not undefined — if the relationship
    // name were wrong PostgREST would error, but if the KEY were wrong the
    // property would simply be missing and every thread would read as unlinked.
    const embedPresent = rows.every((r) => Array.isArray(r.links))
    check(
      embedPresent,
      'the thread_links embed is present on every row',
      embedPresent
        ? 'every row carries a links array, so "has no link" is a real answer'
        : 'at least one row has no `links` property — the embed key is wrong and EVERY thread would read as unlinked'
    )

    const cursorTyped = rows.every((r) => typeof r.attachments_through === 'number')
    check(
      cursorTyped,
      'attachments_through is a number on every row',
      cursorTyped
        ? 'NOT NULL default 0 holds, so the cursor comparison needs no coalesce'
        : 'a null cursor would make `>=` return NULL, which is not true, and the thread would be skipped forever'
    )

    const owed = rows.filter(
      (r) => (r.links ?? []).length === 0 && (r.attachments_through ?? 0) < (r.message_count ?? 0)
    )
    const files = owed.reduce((n, r) => n + (r.attachment_count ?? 0), 0)
    console.log(`\n       BACKLOG: ${owed.length} threads owed a read, carrying ${files} files`)
  }
}

console.log('\n── 2. The widened noise gate, both arms, on real rows ──\n')

{
  const { count: pending } = await db
    .from('email_threads_pending_embed')
    .select('id', { count: 'exact', head: true })
  console.log(`       the view offers ${pending ?? 0} threads to index\n`)

  // RECOVERED ARM — asked of the OUTCOME, not of the queue.
  //
  // ⚠ THE OBVIOUS VERSION OF THIS ASSERTION DECAYS INTO A VACUOUS PASS. Reading
  // the pending VIEW for an attachment-bearing thread works only while the
  // backlog is undrained; once the sweep has caught up the view is empty BY
  // DESIGN and the check proves nothing — which is exactly what happened on the
  // second run of this script, within an hour of the migration. So ask whether
  // these threads ended up INDEXED, which stays true permanently and is the
  // thing actually wanted. A count that is only meaningful before the fix has
  // landed is not a regression test.
  const { data: twoFact } = await db
    .from('email_threads')
    .select('id, subject, attachment_count, message_count')
    .eq('pipeline', 'deal')
    .eq('summary_state', 'summarized')
    .gt('attachment_count', 0)
    .filter('summary->>relevance', 'eq', 'noise')
    .limit(200)
  const tf = (twoFact ?? []) as Array<{
    id: string
    subject: string | null
    attachment_count: number | null
  }>

  if (population(tf.length, 'the two-fact recovered population exists')) {
    const ids = tf.map((r) => r.id)
    const indexed = new Set<string>()
    // ⚠ PAGINATED, AND THE FIRST VERSION OF THIS CHECK WAS WRONG BECAUSE IT WAS
    // NOT. §12: PostgREST truncates at 1000 rows, SILENTLY. One thread holds
    // many chunks, so `.in(thread_id, <200 ids>)` asks for a couple of thousand
    // rows and gets exactly 1000 — which showed as 98 of 200 threads "not
    // indexed" and read as a real failure of the gate. psql said 228 of 228.
    // A verification script reading a truncated set is worse than none, because
    // it is believed (§12), and this one very nearly was.
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200)
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from('thread_chunks')
          .select('thread_id')
          .in('thread_id', batch)
          .range(from, from + 999)
        if (error) {
          console.error(`       could not read thread_chunks: ${error.message}`)
          break
        }
        const page = (data ?? []) as { thread_id: string }[]
        for (const r of page) indexed.add(r.thread_id)
        if (page.length < 1000) break
      }
    }
    const share = indexed.size / tf.length
    // Every one of them should be indexed. A thread in this set is summarized
    // and carries a file, and `embedThread` indexes the body text whatever the
    // attachment turns out to be — so the honest bar is ALL of them, with the
    // exceptions named rather than absorbed into a percentage.
    check(
      indexed.size === tf.length,
      'attachment-bearing noise threads are now in the retrieval index',
      `${indexed.size} of ${tf.length} carry chunks (${Math.round(share * 100)}%) — before the gate widened, every one of these was unsearchable unless a human had asserted a filing`
    )
    const missed = tf.filter((r) => !indexed.has(r.id)).slice(0, 5)
    if (missed.length > 0) {
      console.log(
        `       NOT indexed: ${missed
          .map((r) => `"${(r.subject ?? '(none)').slice(0, 40)}"`)
          .join(', ')}`
      )
    }
  }

  // WITHHELD ARM: deal-noise with no file and no back-and-forth. Must be out.
  // Asked of the TABLE and then of the VIEW, so the answer is a difference
  // between two reads rather than a restatement of one predicate.
  const { data: bare } = await db
    .from('email_threads')
    .select('id, subject')
    .eq('pipeline', 'deal')
    .eq('summary_state', 'summarized')
    .eq('attachment_count', 0)
    .lt('message_count', 3)
    .filter('summary->>relevance', 'eq', 'noise')
    .limit(200)
  const bareRows = (bare ?? []) as Array<{ id: string; subject: string | null }>

  if (population(bareRows.length, 'the withheld arm is non-empty')) {
    const ids = bareRows.map((r) => r.id)
    // Chunked: a filter rides in the query string (§12 — the URI cap).
    let leaked = 0
    for (let i = 0; i < ids.length; i += 200) {
      const { count } = await db
        .from('email_threads_pending_embed')
        .select('id', { count: 'exact', head: true })
        .in('id', ids.slice(i, i + 200))
      leaked += count ?? 0
    }
    check(
      leaked === 0,
      'a bare notification is still withheld',
      leaked === 0
        ? `all ${bareRows.length} file-free, reply-free noise threads stayed out — e.g. "${(bareRows[0].subject ?? '').slice(0, 50)}"`
        : `${leaked} of ${bareRows.length} leaked into the index — the gate opened too far`
    )
  }
}

console.log('\n── 3. What the orphan path has actually produced ──\n')

{
  const { count: orphans } = await db
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('awaiting_filing', true)
    .is('excluded_at', null)

  console.log(`       ${orphans ?? 0} documents awaiting a filing decision`)

  // ⚠ `is_reference` MUST STAY OFF THEM. That flag backs the /intake reading
  // shelf, rendered 30 rows at a time; 809 mail attachments wearing it would
  // push every genuinely uploaded document off that list. It satisfies the
  // scope CHECK, which is exactly why it was tempting and wrong.
  const { count: onShelf } = await db
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('awaiting_filing', true)
    .eq('is_reference', true)
  check(
    (onShelf ?? 0) === 0,
    'no unparented file landed on the /intake reading shelf',
    (onShelf ?? 0) === 0
      ? 'awaiting_filing and is_reference are disjoint, as intended'
      : `${onShelf} rows carry both — the reading shelf is being swamped`
  )

  // ⚠ THE ONE THING THAT MUST NEVER BE TRUE: an unparented file in the COMPANY
  // corpus. `filter_include_company` is an OR branch, so a deal document marked
  // is_company widens every project-scoped question — the exact pollution
  // documents/unfiled.ts exists to fight.
  const { count: polluted } = await db
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('awaiting_filing', true)
    .eq('is_company', true)
  check(
    (polluted ?? 0) === 0,
    'no mail attachment became company knowledge',
    (polluted ?? 0) === 0
      ? 'the orphan path leaves is_company at its false default, as intended'
      : `${polluted} unparented mail attachments are marked is_company and are widening every project question`
  )
}

console.log(
  failures === 0
    ? '\n✓ all assertions passed\n'
    : `\n✗ ${failures} assertion${failures === 1 ? '' : 's'} failed\n`
)
// ⚠ NOT inside a `finally` — §12: a verification script whose finally calls
// process.exit swallows the throw it is unwinding.
process.exit(failures === 0 ? 0 : 1)
