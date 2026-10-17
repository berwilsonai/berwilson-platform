/**
 * Recompute `match_candidates` on the staged intake sessions with the shared
 * record resolver, so the queue can finally offer a merge.
 *
 * WHY A BACKFILL IS NEEDED AT ALL, AND WHY RE-RUNNING PREDECIDE WOULD NOT HAVE
 * WORKED. `match_candidates` is written ONCE, by the sweep's analyze phase, and
 * `predecidePendingSessions` only READS it off the row — it is the closed list
 * the model must choose a merge target from. So every session staged before
 * 2026-10-17 carries the old trigram-at-0.3, projects-only candidate list, and
 * re-running the model over those rows would have re-read the same stale list
 * and reached the same conclusion, at a cost of ~126 local model calls. The
 * candidates have to be recomputed first. This does that, and calls no model.
 *
 * WHAT IT MEASURED (2026-10-16, before the change):
 *   126 sessions pending, 110 proposing `create` at 0.93 average confidence,
 *   against a register of 19 projects and 7 opportunities. Accepting that queue
 *   would have created ~105 records. Of the 106 pending EMAIL sessions
 *   proposing create, the new resolver reaches a live record for 18 and refuses
 *   5 as ambiguous — 8 of the 18 are OPPORTUNITIES, which could not be a
 *   candidate at all before (MatchCandidate had no field for one).
 *
 * ⚠ THIS DOES NOT CHANGE ANY DISPOSITION. It rewrites the candidate list only.
 * The stored `predecision` still says whatever the model said last time, so a
 * second pass is needed for /decide to show a merge — see "AFTERWARDS" below.
 * Nothing is created, nothing is confirmed, no record is touched: the only
 * column written is `email_intake_sessions.match_candidates`.
 *
 * IDEMPOTENT, AND DELIBERATELY VERIFIABLE AS SUCH. Run it twice and the second
 * run must report 0 changed (§12 — a pass that reports what it did must read
 * before it writes, or it claims work it did not do).
 *
 * Usage (from the repo root, on the Studio):
 *   node --experimental-strip-types --import ./scripts/register-aliases.mjs \
 *        --env-file=.env.local scripts/restage-intake-candidates.mts [--check]
 *
 *   --check     read and report, write nothing
 *   --redecide  ALSO clear the stored verdict on the sessions that now reach a
 *               record, so the hourly sweep re-decides them against the new
 *               candidate list (see WHY A VERSION BUMP IS THE WRONG TOOL below)
 *
 * ⚠ WHY A PROMPT-VERSION BUMP IS THE WRONG TOOL HERE. predecidePendingSessions
 * only revisits a session whose `predecision` is null or whose stored
 * prompt_version differs from the current one — and all 118 email rows carry
 * the current `intake-predecide-2.0`, so the sweep would skip every one of
 * them. Bumping that constant would indeed pick them all up, but the PROMPT did
 * not change: its candidate INPUT did, for 24 of 118 rows. A bump would spend
 * ~94 needless local model calls — roughly 90 minutes of exclusive LM Studio
 * time — to re-derive answers that cannot change. So `--redecide` nulls the
 * verdict on exactly the rows that can move, and the hourly sweep picks them up
 * through the `predecision.is.null` arm of the same gate. No new machinery.
 *
 * The predicate is derived, not remembered: a session is re-decidable when its
 * candidates carry a `record_name_` reason (only the new matcher emits those)
 * and its verdict is still `create`. That makes --redecide idempotent — once
 * the verdict is null it no longer matches.
 *
 * AFTERWARDS, to let the model re-decide against the new candidates:
 *   curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *        http://127.0.0.1:3000/api/cron/email-sweep
 *   ⚠ That IS a model pass — roughly one call per session, and LM Studio serves
 *   ONE request at a time, so budget 1–2 hours of exclusive model time and run
 *   it off-peak. Never beside an OCR or re-embed pass.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { findMatchingRecords, type MatchCandidate } from '@/lib/ai/proposal-matching'
import { toProposalExtraction } from '@/lib/email-ingestion/analyze'
import type { EmailIntakeExtraction } from '@/lib/ai/prompts/email-intake'
import type { JsonIn } from '@/lib/supabase/types'

const CHECK = process.argv.includes('--check')
const REDECIDE = process.argv.includes('--redecide')

/** A stable, order-independent fingerprint, so "changed" means changed. */
function fingerprint(raw: unknown): string {
  if (!Array.isArray(raw)) return ''
  return raw
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>
      const id = o.project_id ?? o.opportunity_id ?? ''
      return `${String(id)}:${String(o.score ?? '')}`
    })
    .sort()
    .join('|')
}

function describe(cands: MatchCandidate[]): string {
  if (!cands.length) return '(none)'
  return cands
    .map(
      (c) =>
        `${c.opportunity_name ?? c.project_name}` +
        `${c.kind === 'opportunity' ? ' [opp]' : ''}` +
        ` ${c.score.toFixed(2)} ${c.match_reasons.join(',')}`
    )
    .join('; ')
}

const db = createAdminClient()

const { data: rows, error } = await db
  .from('email_intake_sessions')
  .select('id, label, status, intake_kind, extraction_result, match_candidates, predecision')
  .eq('status', 'pending')
  .limit(1000)

if (error) {
  console.error('could not read sessions:', error.message)
  process.exit(1)
}

// A meeting's candidates are RECORDS A CALL NAMED, produced by a different
// phase (analyze-meeting) with a different meaning. Rewriting them with the
// email matcher would be the §12 "never fork a shared pass" error inverted —
// one pass writing over another kind's rows.
const sessions = (rows ?? []).filter((r) => (r.intake_kind ?? 'email') === 'email')

console.log(
  `\n${rows?.length ?? 0} pending session(s), ${sessions.length} of them email` +
    `${CHECK ? '  — CHECK MODE, nothing will be written' : ''}`
)
console.log('='.repeat(100))

let changed = 0
let unchanged = 0
let failed = 0
let gainedCandidate = 0
let lostCandidate = 0
let reachesOpportunity = 0

for (const s of sessions) {
  const label = (s.label ?? s.id).slice(0, 58)
  let next: MatchCandidate[]
  try {
    const shape = toProposalExtraction(s.extraction_result as unknown as EmailIntakeExtraction)
    next = await findMatchingRecords(shape.projects, { includeOpportunities: true })
  } catch (err) {
    console.log(`  SKIP  ${label.padEnd(58)} ${(err as Error).message}`)
    failed++
    continue
  }

  const before = fingerprint(s.match_candidates)
  const after = fingerprint(next as unknown)
  const hadAny = Array.isArray(s.match_candidates) && s.match_candidates.length > 0

  if (before === after) {
    unchanged++
    continue
  }

  if (!hadAny && next.length) gainedCandidate++
  if (hadAny && !next.length) lostCandidate++
  if (next.some((c) => c.kind === 'opportunity')) reachesOpportunity++

  console.log(`  ${CHECK ? 'WOULD' : 'WRITE'} ${label}`)
  console.log(`        was: ${describe((s.match_candidates ?? []) as unknown as MatchCandidate[])}`)
  console.log(`        now: ${describe(next)}`)

  if (!CHECK) {
    const { error: upErr } = await db
      .from('email_intake_sessions')
      .update({ match_candidates: next as unknown as JsonIn })
      .eq('id', s.id)
    if (upErr) {
      console.log(`        FAILED to write: ${upErr.message}`)
      failed++
      continue
    }
  }
  changed++
}

console.log('='.repeat(100))
console.log(`${CHECK ? 'would change' : 'changed'}: ${changed}   unchanged: ${unchanged}   failed: ${failed}`)
console.log(`  gained a candidate where there was none: ${gainedCandidate}`)
console.log(`  lost a candidate (trigram had one, the word test refuses it): ${lostCandidate}`)
console.log(`  now reach an OPPORTUNITY (impossible before): ${reachesOpportunity}`)
if (REDECIDE) {
  // Derived, never remembered — see the header. Only the new matcher emits a
  // `record_name_` reason, and only a `create` verdict can move to a merge.
  const { data: movable } = await db
    .from('email_intake_sessions')
    .select('id, label, match_candidates, predecision')
    .eq('status', 'pending')
    .eq('intake_kind', 'email')
    .limit(1000)

  const targets = (movable ?? []).filter((r) => {
    const pre = (r.predecision ?? {}) as Record<string, unknown>
    if (pre.disposition !== 'create') return false
    const cands = Array.isArray(r.match_candidates) ? r.match_candidates : []
    return cands.some((c) => {
      const reasons = ((c ?? {}) as Record<string, unknown>).match_reasons
      return Array.isArray(reasons) && reasons.some((x) => String(x).startsWith('record_name_'))
    })
  })

  console.log(`\n${CHECK ? 'would clear' : 'clearing'} the verdict on ${targets.length} session(s) that now reach a record:`)
  for (const t of targets) console.log(`  - ${(t.label ?? t.id).slice(0, 80)}`)

  if (!CHECK) {
    for (const t of targets) {
      const { error: e } = await db
        .from('email_intake_sessions')
        .update({ predecision: null })
        .eq('id', t.id)
      if (e) console.log(`    FAILED ${t.id}: ${e.message}`)
    }
    console.log(
      `\nDone. The hourly email sweep will re-decide these — roughly one local model call\n` +
        `each, and LM Studio serves ONE request at a time. Until it runs they show no\n` +
        `verdict in /decide rather than a stale one, which is the honest state.`
    )
  }
} else {
  console.log(
    `\nNo disposition was touched. For /decide to offer these as merges, the model has to\n` +
      `re-decide against the new lists — pass --redecide, or see AFTERWARDS in the header.`
  )
}
if (!CHECK && changed > 0) {
  console.log(`\nRun again with no flags: it must report "changed: 0" (idempotence).`)
}
