/**
 * Assert the correspondence index's eligibility rule, against the live database.
 *
 * The rule lives in SQL (`email_threads_pending_embed`), so `npm test` cannot
 * reach it — and it is a rule with real consequences in both directions: too
 * tight and deal mail is silently unanswerable, too loose and newsletters match
 * against every record they name.
 *
 * Four properties, each one a bug that was real:
 *   1. a deal thread the summarizer called noise, with NO link, stays OUT —
 *      that is the newsletter case the exclusion exists for;
 *   2. a noise thread carrying an ASSERTED (certainty='linked') link is IN —
 *      48 were wrongly withheld until 2026-10-21, among them the Helper
 *      appraisal and the executed Englert agreed terms;
 *   3. a noise thread whose only link is `inferred` stays OUT — that tier is a
 *      similarity score, and §12 wants a fact;
 *   4. a lead thread, which carries no summary at all, is IN — a plain
 *      .neq() on relevance drops NULLs and would exclude the whole pipeline.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/verify-pending-embed-view.mts
 */

import { sweepDb } from '@/lib/email-sweep/db'

const db = sweepDb()
let failures = 0

/**
 * ⚠ PostgREST truncates at 1000 rows SILENTLY and `.limit()` does not beat it
 * (§12). The first run of this script read exactly 1000 threads and reported
 * a confident green over a corpus of 1,313 — a verification script that
 * measures a truncated set is worse than no script, because it is believed.
 */
type Query = ReturnType<ReturnType<typeof sweepDb>['from']>['select'] extends (
  ...a: never[]
) => infer R
  ? R
  : never

async function all<T>(table: string, cols: string, tune?: (q: Query) => Query): Promise<T[]> {
  const out: T[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    let q = db.from(table).select(cols).range(from, from + page - 1)
    if (tune) q = tune(q)
    const { data, error } = await q
    if (error) throw new Error(`${table} unreadable: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < page) return out
  }
}

/**
 * A check with nothing to test PASSED VACUOUSLY and must say so, or "4 passed"
 * stands in for "4 were exercised" — which is how an empty corpus certifies a
 * broken rule.
 */
function check(name: string, population: number, ok: boolean, detail: string) {
  if (population === 0) {
    console.log(`  – ${name} — NOT EXERCISED (nothing in this state right now)`)
    return
  }
  console.log(`${ok ? '  ✓' : '  ✗'} ${name} — ${detail}`)
  if (!ok) failures++
}

// The view's membership, as a set we can ask about.
const viewRows = await all<{ id: string }>('email_threads_pending_embed', 'id')
const eligible = new Set(viewRows.map((r) => r.id))

// Every thread the view COULD be asked about: unembedded and summarized.
type Row = { id: string; pipeline: string | null; summary: { relevance?: string } | null }
const rows = await all<Row>('email_threads', 'id, pipeline, summary', (q) =>
  q.eq('summary_state', 'summarized').is('embedded_at', null)
)

type Link = { thread_id: string; certainty: string }
const links = await all<Link>('thread_links', 'thread_id, certainty')
const asserted = new Set<string>()
const inferredOnly = new Set<string>()
for (const l of links) if (l.certainty === 'linked') asserted.add(l.thread_id)
for (const l of links) {
  if (l.certainty !== 'linked' && !asserted.has(l.thread_id)) inferredOnly.add(l.thread_id)
}

const noise = rows.filter((r) => r.summary?.relevance === 'noise')
const noiseNoLink = noise.filter((r) => !asserted.has(r.id) && !inferredOnly.has(r.id))
const noiseAsserted = noise.filter((r) => asserted.has(r.id))
const noiseInferred = noise.filter((r) => inferredOnly.has(r.id))
const leads = rows.filter((r) => r.pipeline === 'lead' && !r.summary?.relevance)

console.log(
  `\nUnembedded + summarized: ${rows.length} (${noise.length} noise; ` +
    `${noiseAsserted.length} asserted, ${noiseInferred.length} inferred-only, ` +
    `${noiseNoLink.length} unlinked) · view holds ${eligible.size}\n`
)

check(
  'unlinked deal-noise stays OUT',
  noiseNoLink.length,
  noiseNoLink.every((r) => !eligible.has(r.id)),
  `${noiseNoLink.filter((r) => eligible.has(r.id)).length} of ${noiseNoLink.length} leaked in`
)
check(
  'asserted (linked) noise is IN',
  noiseAsserted.length,
  noiseAsserted.every((r) => eligible.has(r.id)),
  `${noiseAsserted.filter((r) => !eligible.has(r.id)).length} of ${noiseAsserted.length} still withheld`
)
check(
  'inferred-only noise stays OUT',
  noiseInferred.length,
  noiseInferred.every((r) => !eligible.has(r.id)),
  `${noiseInferred.filter((r) => eligible.has(r.id)).length} of ${noiseInferred.length} leaked in`
)
check(
  'lead threads (null relevance) are IN',
  leads.length,
  leads.every((r) => eligible.has(r.id)),
  `${leads.filter((r) => !eligible.has(r.id)).length} of ${leads.length} dropped`
)

const exercised = noiseNoLink.length + noiseAsserted.length + noiseInferred.length + leads.length
console.log(`\n${exercised} threads exercised the rule.`)

console.log(failures === 0 ? '\nOK\n' : `\n${failures} FAILED\n`)
process.exitCode = failures === 0 ? 0 : 1
