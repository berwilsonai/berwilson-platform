/**
 * Does the shared record resolver actually reach the deals the old matcher missed?
 *
 * WHY THIS SCRIPT EXISTS. `resolveRecordByName` reads the database, so the unit
 * tests beside it can only cover the pure word logic. The claim being checked
 * here is the one that justified the whole change: that the email intake path
 * was proposing `create` for threads about records that already exist, because
 * its trigram matcher could not see them.
 *
 * It is READ-ONLY. Nothing is written, nothing is staged, no model is called —
 * so it is safe to run against production at any time, and cheap enough to
 * re-run after any edit to the stopword list.
 *
 * The cases below are REAL titles taken from the 110 pending sessions that
 * proposed creating a new record on 2026-10-16, each paired with the live record
 * a human would file it onto. `expect: null` rows are the control: queue titles
 * that genuinely name no deal, which must stay unresolved — a matcher that
 * answers everything is worse than one that answers nothing, because §12 says
 * ambiguity must mean no match.
 *
 * Usage (from the repo root, on the Studio):
 *   node --experimental-strip-types --import ./scripts/register-aliases.mjs \
 *        --env-file=.env.local scripts/verify-record-resolver.mts
 *
 * Exits non-zero if any case regresses, so it can be wired into a check later.
 */

import { resolveRecordByName } from '../src/lib/records/resolve.ts'

interface Case {
  title: string
  /** The live record name this should reach, or null for "must not resolve". */
  expect: string | null
  why?: string
}

const CASES: Case[] = [
  // ── Titles that sat in the queue as `create` and name a live record ───────
  { title: 'Steelton Letter-PPL', expect: 'Steelton — Cleveland-Cliffs (PA)' },
  { title: 'Steelton Data Center Development & Site Evaluation', expect: 'Steelton — Cleveland-Cliffs (PA)' },
  { title: 'Helper Data Center & Community Development', expect: 'DUBHES Helper / Giovanni Resilience Campus' },
  { title: 'New York Life Helper Development', expect: 'DUBHES Helper / Giovanni Resilience Campus' },
  { title: 'Black Mesa / Tooele Defense Project', expect: 'Tooele' },
  { title: 'Myton Industrial Park / PQC DataCenter Development', expect: null,
    why: 'names Myton Development AND Myton Rail — ambiguity must refuse (§12)' },

  // ── The opportunities that were structurally unreachable before today ────
  { title: 'WES / GridEdge Modular Data Center Partnership', expect: 'GridEdge' },
  { title: 'Elite Solutions / Delta Energy Project', expect: null,
    why: 'names Elite Solutions AND Delta Industrial Campus — must refuse' },

  // ── Exact names must hit the exact bar, not the word bar ─────────────────
  { title: 'Tooele', expect: 'Tooele' },
  { title: 'Whiskey (TX)', expect: 'Whiskey (TX)' },
  { title: 'GridEdge', expect: 'GridEdge' },

  // ── Controls: queue titles that name no deal and must stay unresolved ────
  { title: 'ADU models', expect: null },
  { title: 'Big client pursuit', expect: null },
  { title: 'Quit Claim Deed', expect: null },
  { title: '7 Jurisdictions IDIQ', expect: null },

  // ── The §12 pairs a score cannot separate ────────────────────────────────
  { title: 'Eagle Mountain Development', expect: null,
    why: 'scored 0.487 against Myton Development — the WRONG match scored higher' },
  { title: 'Delta, Utah Campus', expect: 'Delta Industrial Campus — Daves Farms',
    why: 'scored 0.390, lower than the wrong match above, and is right' },
  { title: 'West Virginia Power Site', expect: null,
    why: 'resolved to West Wendover on the word *west* before directions were stopworded' },
]

const label = (s: string) => (s.length > 52 ? s.slice(0, 49) + '...' : s).padEnd(52)

let pass = 0
let fail = 0
const failures: string[] = []

console.log('\nResolving real queue titles against the live register')
console.log('='.repeat(96))

for (const c of CASES) {
  const r = await resolveRecordByName([c.title])
  const hit = r.target ?? r.suggestion ?? null
  const got = hit?.name ?? null
  const ok = got === c.expect

  const via = r.via ? `via ${r.via}` : r.ambiguous ? 'refused (ambiguous)' : 'no match'
  console.log(
    `${ok ? '  ok  ' : '  FAIL'} ${label(c.title)} -> ${(got ?? '(nothing)').padEnd(44)} ${via}`
  )
  if (!ok) {
    failures.push(`${c.title}\n        expected: ${c.expect ?? '(nothing)'}\n        got:      ${got ?? '(nothing)'}${r.ambiguous ? `\n        reason:   ${r.ambiguous}` : ''}`)
    fail++
  } else {
    pass++
  }
  if (c.why && !ok) console.log(`        note: ${c.why}`)
}

console.log('='.repeat(96))
console.log(`${pass} ok, ${fail} failed, ${CASES.length} cases`)

if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(
    '\n⚠ A failure here is not automatically a bug in the resolver — the register changes.\n' +
      '  Check whether the expected record still exists under that name before editing code.'
  )
  process.exit(1)
}
console.log('\nEvery case resolved as expected.')
