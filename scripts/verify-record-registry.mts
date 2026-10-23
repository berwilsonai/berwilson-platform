/**
 * Aliases on the record register, asserted on live rows.
 *
 * ⚠ THIS SCRIPT USED TO CARRY A SECOND CHECK, OVER `MSPA_REGISTER` — a
 * hand-written list of every project and opportunity, keyed by name, which
 * `/mspa` read through `findRecord(name)`. It was here because a record added
 * to the database and not to that list was silently absent from the partnership
 * screen. Both the register and `/mspa` were removed on 2026-10-23 with the
 * calculator, so the check went with them. The check below is the one that was
 * always the more valuable of the two.
 *
 * ⚠ AND IT WAS A REAL FAILURE ON 2026-10-21, WHICH NOTHING REPORTED.
 * An ALIAS CLAIMED BY TWO RECORDS MAKES BOTH OF THEM UNMATCHABLE. The alias
 *    bar in `resolveRecordByName` refuses on ambiguity rather than guessing —
 *    which is right — so a collision does not mis-file anything, it silently
 *    stops filing altogether. `True North` was claimed by both Alaska deals
 *    within minutes of aliases being asserted, and the only reason it was
 *    caught is that somebody ran the query by hand. An alias that duplicates a
 *    DIFFERENT record's whole name is the same failure wearing a hat.
 *
 * Neither is a schema constraint, because neither can be: the register is
 * TypeScript and the aliases are a text[] on two tables. So it is a check.
 *
 * Run: node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/verify-record-registry.mts
 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { aliasMatches } from '../src/lib/records/resolve'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function main() {
  const supabase = createAdminClient()
  const [{ data: projects }, { data: opportunities }] = await Promise.all([
    supabase.from('projects').select('name, match_aliases'),
    supabase.from('opportunities').select('name, match_aliases'),
  ])

  const live = [
    ...(projects ?? []).map((r) => ({ ...r, kind: 'project' as const })),
    ...(opportunities ?? []).map((r) => ({ ...r, kind: 'opportunity' as const })),
  ]
  check('both record tables were readable', live.length > 0, `${live.length} records`)

  // ── Aliases are unambiguous ───────────────────────────────────────────────
  const byAlias = new Map<string, string[]>()
  for (const r of live) {
    for (const raw of (r.match_aliases ?? []) as string[]) {
      const key = raw.trim().toLowerCase()
      if (!key) continue
      byAlias.set(key, [...(byAlias.get(key) ?? []), r.name])
    }
  }
  const collisions = [...byAlias.entries()].filter(([, owners]) => owners.length > 1)
  check(
    'no alias is claimed by two records',
    collisions.length === 0,
    collisions.length
      ? collisions.map(([a, o]) => `"${a}" → ${o.join(' + ')}`).join('; ')
      : `${byAlias.size} aliases across ${live.filter((r) => (r.match_aliases ?? []).length > 0).length} records`
  )

  const shadows: string[] = []
  for (const [alias, owners] of byAlias) {
    for (const r of live) {
      if (owners.includes(r.name)) continue
      if (r.name.trim().toLowerCase() === alias) shadows.push(`"${alias}" is also the whole name of ${r.name}`)
    }
  }
  check(
    "no alias is another record's whole name",
    shadows.length === 0,
    shadows.length ? shadows.join('; ') : 'none'
  )

  // ⚠ THE SHARPER VERSION OF THE SAME QUESTION, and the one a reader cannot do
  // by eye: an alias matches by TOKEN CONTAINMENT, so `Myton` would be carried
  // by the name "Myton Rail" even though the strings differ. An alias that
  // matches another record's NAME under the real rule is as ambiguous as a
  // literal duplicate, and the resolver would refuse both.
  const overlaps: string[] = []
  for (const [alias, owners] of byAlias) {
    const alsoMatches = live.filter((r) => !owners.includes(r.name) && aliasMatches(alias, r.name))
    if (alsoMatches.length > 0) {
      overlaps.push(`"${alias}" (${owners.join('+')}) also matches ${alsoMatches.map((r) => r.name).join(', ')}`)
    }
  }
  check(
    'no alias also matches a different record by the real rule',
    overlaps.length === 0,
    overlaps.length ? overlaps.join('; ') : 'none'
  )

  // ── 3. A lead-pipeline thread is never guessed onto a deal record ────────
  //
  // ⚠ 19 WERE, UNTIL 2026-10-21. info@'s inbound trade leads are a different
  // corpus with a different job — scored and triaged on /leads — and
  // `clusterUnassigned` has always excluded them from proposing a record while
  // the ROUTER did not. A town's name inside "Customer T. R. needs Concrete
  // Installation in Eagle Mountain, UT" filed three such notices onto a data
  // centre project. The one legitimate shape is a PROMOTION, which writes its
  // link as a derived fact before any matching runs.
  const { data: leaked } = await supabase
    .from('thread_links')
    .select('record_kind, reason, email_threads!inner(pipeline)')
    .neq('record_kind', 'lead')
    .eq('email_threads.pipeline', 'lead')
  const bad = (leaked ?? []).filter((r) => (r.reason ?? '') !== 'promoted from this lead')
  check(
    'no lead-pipeline thread is filed onto a deal record by a guess',
    bad.length === 0,
    bad.length
      ? `${bad.length}: ${[...new Set(bad.map((r) => r.reason ?? '?'))].slice(0, 3).join('; ')}`
      : `${(leaked ?? []).length} promotion link(s) only`
  )

  console.log('')
  console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`)
  process.exitCode = failures === 0 ? 0 : 1
}

// No `finally { process.exit() }` — §12: it swallows the throw it is unwinding.
await main()
