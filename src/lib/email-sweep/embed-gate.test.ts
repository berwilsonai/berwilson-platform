/**
 * The mail index's noise gate, read against the migration that defines it.
 *
 * ⚠ READ THE REAL ARTIFACT, NEVER A COPY (§12 — a test that hardcodes the value
 * it verifies is testing the copy; `contrast.test.ts` pasted the palette in and
 * kept passing against colours that no longer existed). The predicate lives in
 * `email_threads_pending_embed` and NOWHERE else, deliberately, so that
 * `embedPendingThreads`'s selector and its `remaining` count cannot drift apart.
 * That means a unit test cannot evaluate it — there is no TypeScript copy to
 * call, and writing one would create exactly the second home the design avoids.
 *
 * So this asserts the SHAPE of the real SQL: that both facts are present, that
 * the widening is scoped to the deal pipeline, and that the three original arms
 * survived. Behaviour on live rows is proven separately and properly by
 * `scripts/verify-ingestion-recovery.mts`, which queries the view for an
 * attachment-bearing thread (must be offered) and a bare notification (must
 * still be withheld).
 *
 * What this catches is the regression that would otherwise be invisible:
 * somebody replacing the view later and dropping an arm. A dropped arm does not
 * fail anything — it just silently stops indexing a class of mail, which is the
 * failure this whole change existed to fix.
 */

import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const MIGRATION = 'supabase/migrations/20261025000010_embed_noise_threads_on_two_facts.sql'

/** The view body, lowercased and collapsed, with the comment block stripped. */
function viewSql(): string {
  const raw = readFileSync(MIGRATION, 'utf8')
  // ⚠ STRIP THE COMMENTS FIRST (§12 — a test that scans source must strip
  // comments or it measures its own documentation). This file's header explains
  // the rule at length and names every column in it, so a naive search would
  // pass on the prose alone even if the SQL were empty.
  const sql = raw
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
  const start = sql.toLowerCase().indexOf('create or replace view')
  assert.ok(start >= 0, 'the migration no longer creates the view')
  return sql.slice(start).toLowerCase().replace(/\s+/g, ' ')
}

test('the view still exists and selects from email_threads', () => {
  const sql = viewSql()
  assert.match(sql, /create or replace view email_threads_pending_embed/)
  assert.match(sql, /from email_threads/)
})

test('the three original arms survive', () => {
  const sql = viewSql()
  // Only unsummarized/already-indexed threads are excluded by these two.
  assert.match(sql, /summary_state = 'summarized'/)
  assert.match(sql, /embedded_at is null/)
  // A thread with no relevance verdict at all is indexed, not withheld.
  assert.match(sql, /\(summary ->> 'relevance'\) is null/)
  // A human's asserted filing overrides the model's noise verdict. This is the
  // arm that was the ONLY escape hatch before the two facts were added.
  assert.match(sql, /certainty = 'linked'/)
})

test('the gate opens on an ATTACHMENT', () => {
  const sql = viewSql()
  assert.match(
    sql,
    /coalesce\(t\.attachment_count, 0\) >= 1/,
    'a thread carrying a file must be indexed whatever its prose is worth — this is the arm that recovers "Requested information" (14 files) and "Powers Mines" (11)'
  )
})

test('the gate opens on a real BACK-AND-FORTH', () => {
  const sql = viewSql()
  assert.match(
    sql,
    /coalesce\(t\.message_count, 0\) >= 3/,
    'a conversation with two replies is not a notification — a notification never gets two replies'
  )
})

test('both counts are coalesced, because NULL >= 1 is not false but NULL', () => {
  const sql = viewSql()
  // ⚠ THE WHOLE RECOVERY WOULD SILENTLY RETURN NOTHING WITHOUT THIS. Both
  // columns are nullable; `null >= 1` is NULL, which is not true, so an
  // uncoalesced comparison withholds exactly the rows it was written to admit —
  // and reports it as an empty result, not an error (§12).
  assert.ok(
    !/[^(]\bt\.attachment_count >= /.test(sql),
    'attachment_count is compared without coalesce — a NULL would withhold the row'
  )
  assert.ok(
    !/[^(]\bt\.message_count >= /.test(sql),
    'message_count is compared without coalesce — a NULL would withhold the row'
  )
})

test('the widening is scoped to the DEAL pipeline', () => {
  const sql = viewSql()
  // ⚠ A LEAD'S ATTACHMENTS ARE NOT DEAL EVIDENCE. 1,965 lead threads would
  // swamp the index and the queue; leads have their own triage. The scope is in
  // the predicate rather than left to a downstream filter so the view is honest
  // about what it is for.
  assert.match(sql, /t\.pipeline = 'deal'/)

  // And the scope must be ANDed with the facts, not ORed beside them — an OR
  // would admit every deal thread regardless of either fact, which is the
  // "drop the gate entirely" option that was considered and rejected.
  assert.match(
    sql,
    /t\.pipeline = 'deal' and \(coalesce/,
    'the deal scope must be ANDed with the two facts, or the gate is simply off for deal mail'
  )
})
