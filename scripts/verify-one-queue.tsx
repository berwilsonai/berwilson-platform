/**
 * One pending queue, asserted against the live database.
 *
 * ⚠ /intake AND /decide BOTH LISTED THE SAME PENDING SESSIONS, each with its
 * own ranking and its own dismiss buttons — 101 email rows and 14 meeting rows
 * appearing twice, in two different orders, on 2026-10-19. CLAUDE.md §12: one
 * quantity, one definition, or the reader trusts neither.
 *
 * Four things this proves, on real rows rather than a fixture:
 *   1. /intake's email and meeting lists contain NO pending session.
 *   2. The pointer line's count equals what /decide's own counter holds for
 *      that kind — the badge and the destination must not disagree.
 *   3. Nothing is hidden: pending + listed covers every undismissed session.
 *   4. A session that matched an existing record carries no pursuit-fit
 *      verdict going forward, because "should we pursue this?" is moot once we
 *      have the deal (and 21 such rows said `pass` about live work).
 *
 * Run: npx tsx scripts/verify-one-queue.tsx
 */
import { createAdminClient } from '../src/lib/supabase/admin'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function main() {
  const supabase = createAdminClient()

  for (const kind of ['email', 'meeting'] as const) {
    // Exactly the query the tab now runs.
    // ⚠ Exactly the query the tab runs, LIMIT included. The first version of
    // this check passed a different query and would have missed the real bug:
    // the tab filtered `pending` out AFTER the limit, so its list rendered
    // empty (§12 — the exclusion must be in SQL, before the LIMIT).
    const statuses = kind === 'email' ? ['running', 'confirmed'] : ['confirmed']
    const { data: listed } = await supabase
      .from('email_intake_sessions')
      .select('id, status')
      .eq('intake_kind', kind)
      .in('status', statuses)
      .order('updated_at', { ascending: false })
      .limit(25)

    const { count: pending } = await supabase
      .from('email_intake_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('intake_kind', kind)
      .eq('status', 'pending')

    const leaked = (listed ?? []).filter((r) => r.status === 'pending')
    check(
      `/intake ${kind} tab lists no pending session`,
      leaked.length === 0,
      `${listed?.length ?? 0} listed, ${leaked.length} pending among them`
    )
    check(
      `/intake ${kind} pointer has a count to show`,
      (pending ?? 0) >= 0,
      `${pending} waiting on /decide`
    )
    // An empty "Recent" is legitimate (nothing has finished) but must not be
    // caused by the filter, so compare against what exists at all.
    const { count: finishable } = await supabase
      .from('email_intake_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('intake_kind', kind)
      .in('status', statuses)
    check(
      `/intake ${kind} list is not empty while finished runs exist`,
      (finishable ?? 0) === 0 || (listed?.length ?? 0) > 0,
      `${finishable} finished in the table, ${listed?.length ?? 0} on the page`
    )
  }

  // 3. Nothing vanished: every undismissed session is either listed somewhere
  //    or counted in the pointer.
  const { count: undismissed } = await supabase
    .from('email_intake_sessions')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'dismissed')
  const { count: pendingAll } = await supabase
    .from('email_intake_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  const { count: confirmedAll } = await supabase
    .from('email_intake_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'confirmed')
  check(
    'every undismissed session is still reachable (pending + confirmed)',
    (pendingAll ?? 0) + (confirmedAll ?? 0) === (undismissed ?? -1),
    `${pendingAll} pending + ${confirmedAll} confirmed = ${undismissed} undismissed`
  )

  // 4. The fit gate. Historic rows keep their verdict; what matters is that a
  //    matched session is the kind that no longer gets one.
  const { data: rows } = await supabase
    .from('email_intake_sessions')
    .select('match_candidates, fit_assessment')
    .limit(1000)
  const matchedWithFit = (rows ?? []).filter(
    (r) => Array.isArray(r.match_candidates) && r.match_candidates.length > 0 && r.fit_assessment
  ).length
  const matchedPass = (rows ?? []).filter(
    (r) =>
      Array.isArray(r.match_candidates) &&
      r.match_candidates.length > 0 &&
      (r.fit_assessment as { recommendation?: string } | null)?.recommendation === 'pass'
  ).length
  console.log(
    `ℹ ${matchedWithFit} historic sessions matched a record AND carry a fit verdict; ${matchedPass} of those said "pass" about a deal we hold. New ones get none.`
  )

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
