/**
 * The Decide badge and the Decide page must report one number.
 *
 * ⚠ THEY DID NOT, IN BOTH DIRECTIONS AT ONCE, AND THAT IS WHY THIS EXISTS.
 * Measured 2026-10-20:
 *   - `countDecideItems()` counted every pending session, while the page and
 *     the morning brief both skip one whose predecision is `dismiss`. Of 247
 *     decided sessions, 125 carried that verdict — so the badge over-reported
 *     its own destination by roughly double.
 *   - the same count omitted the wrong-deal document lane and the field-question
 *     lane, which the page renders as their own chips — so it could also read
 *     LOWER than the page (38 wrong-deal rows as recently as 10-14).
 * A badge that is wrong in both directions at once cannot be noticed by
 * eyeballing it, which is the whole argument for asserting it.
 *
 * ⚠ BOTH SIDES ARE COMPUTED FROM THEIR OWN SOURCES AND THEN COMPARED. §12: a
 * derived number that agrees by coincidence proves nothing, so this does NOT
 * call `summarizeDecideQueue` and compare it to itself — it re-sums the page's
 * lanes from the same passes the page calls, and checks all three agree.
 *
 * Run: node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/verify-decide-badge.mts
 */
import { countDecideItems, summarizeDecideQueue } from '../src/lib/decide/count'
import { createAdminClient } from '../src/lib/supabase/admin'
import { leadsDb } from '../src/lib/leads/db'
import { findMisfiledCompanyDocuments } from '../src/lib/documents/unfiled'
import { findMisfiledRecordDocuments } from '../src/lib/documents/misfiled'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function main() {
  const supabase = createAdminClient()

  // ── The page's lanes, rebuilt from the page's own sources ────────────────
  const [{ data: sessions }, { data: leadRows }, { count: review }, unfiled, misfiled, { count: fields }] =
    await Promise.all([
      supabase
        .from('email_intake_sessions')
        .select('id, predecision, intake_kind')
        .eq('status', 'pending')
        .limit(1000),
      leadsDb()
        .from('leads')
        .select('id')
        .in('status', ['new', 'reviewing'])
        .or('fit_recommendation.is.null,fit_recommendation.neq.pass')
        .limit(1000),
      supabase.from('review_queue').select('id', { count: 'exact', head: true }).is('resolved_at', null),
      findMisfiledCompanyDocuments(),
      findMisfiledRecordDocuments().catch(() => []),
      supabase
        .from('field_update_proposals')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ])

  // Exactly the skip the page applies at decide/page.tsx and the brief applies
  // when building its prose lines.
  const shown = (sessions ?? []).filter(
    (s) => (s.predecision as { disposition?: string } | null)?.disposition !== 'dismiss'
  )
  const dismissedByModel = (sessions ?? []).length - shown.length

  const lanes = {
    intake: shown.length,
    leads: (leadRows ?? []).length,
    review: review ?? 0,
    documents: unfiled.length,
    misfiled: misfiled.length,
    fieldQuestions: fields ?? 0,
  }
  const pageTotal = Object.values(lanes).reduce((a, b) => a + b, 0)

  const badge = await countDecideItems()
  const brief = await summarizeDecideQueue()

  console.log('lanes:', JSON.stringify(lanes))
  console.log(`sessions the model already dismissed (not shown anywhere): ${dismissedByModel}`)
  console.log('')

  check('badge equals the page', badge === pageTotal, `badge ${badge} vs page ${pageTotal}`)
  check(
    'the brief equals the page',
    brief.total === pageTotal,
    `brief ${brief.total} vs page ${pageTotal}`
  )
  // Named apart, never summed (§12): one is a document with NO deal, the other
  // is a document on the WRONG deal, and the corrections differ.
  check(
    'the brief reports the two document lanes separately',
    brief.documents === lanes.documents && brief.misfiled === lanes.misfiled,
    `documents ${brief.documents}/${lanes.documents}, misfiled ${brief.misfiled}/${lanes.misfiled}`
  )
  check(
    'a model-dismissed session is counted by nobody',
    badge === pageTotal && brief.total === pageTotal,
    dismissedByModel === 0 ? 'none in the queue right now to prove it on' : `${dismissedByModel} excluded`
  )

  console.log('')
  console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`)
  process.exitCode = failures === 0 ? 0 : 1
}

// ⚠ No `finally { process.exit() }` — §12: that swallows the throw it is
// unwinding, and a verification script that exits 0 while hiding an error is
// worse than no script.
await main()
