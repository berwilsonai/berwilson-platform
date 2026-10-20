/**
 * The dismiss loop, against the live database, from both readers.
 *
 * ⚠ THE UNIT TEST FOR THE PREFIXES IS A COPY AND THIS IS THE ORIGINAL. §12: a
 * test that hardcodes the value it verifies is testing the COPY —
 * `attention-kinds.test.ts` holds one sample id per kind, transcribed by hand
 * from `src/lib/attention.ts`, so it proves the registry is self-consistent and
 * nothing more. If the engine renamed a prefix tomorrow that file would still
 * pass while every row of that kind silently became undismissable. So the first
 * thing here asks the ENGINE what ids it is actually producing.
 *
 * Then the loop itself, which has three halves that can disagree:
 *
 *   computeAttention()  filters dismissed items in JavaScript, on rows it has
 *   countAttention()    filters them in SQL, because a `head: true` count never
 *                       receives a row (§12 — a count is an aggregate and a
 *                       row-filter has no equivalent on one; this is exactly
 *                       how a confidential project reached the sidebar badge)
 *   the dismissed list  is the undo, and is itself contained (§8)
 *
 * ⚠ AND IT ASSERTS THE BADGE MOVES, NOT JUST THE LIST. The two are measured
 * from different tables in different vocabularies, which is why this module's
 * own docblock is about three contradictory "needs attention" numbers on one
 * screen. Dismissing an overdue task and watching the sidebar keep counting it
 * would be the fourth.
 *
 * Run: node --import ./deploy/register.mjs scripts/verify-attention-dismiss.mts
 */

import { computeAttention, countAttention } from '../src/lib/attention.ts'
import {
  ATTENTION_KINDS,
  attentionCategoryForKey,
  attentionDeleteTarget,
  attentionRowId,
} from '../src/lib/attention-kinds.ts'
import {
  activeDismissals,
  dismissAttentionItem,
  dismissedRowIds,
  dismissUntil,
  restoreAttentionItem,
} from '../src/lib/attention-dismissals.ts'
import { createAdminClient } from '../src/lib/supabase/admin.ts'

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Everything this run wrote, so the cleanup is exact rather than a wildcard. */
const written: string[] = []

async function main() {
  console.log('\n── What the engine is actually emitting ─────────────────────\n')

  const first = await computeAttention()
  console.log(`  ${first.items.length} live items, ${first.dismissed.length} already dismissed`)

  if (first.items.length === 0) {
    console.log('\n  ⚠ nothing on the list, so nothing below can be proved. Not a pass.\n')
    failures++
    return
  }

  // ⚠ THE REAL PREFIX ASSERTION. Every id the engine produces, resolved through
  // the registry the UI routes with.
  const unresolved = first.items.filter((i) => attentionCategoryForKey(i.id) !== i.category)
  check(
    `all ${first.items.length} live ids resolve to their own kind`,
    unresolved.length === 0,
    unresolved.slice(0, 3).map((i) => `${i.id} → ${attentionCategoryForKey(i.id)} not ${i.category}`).join('; ')
  )

  // And every kind that is actually present carries a parseable row id where it
  // claims to have one. This is the half the fixture cannot reach: the engine
  // builds `waiting-<uuid>-<text>` from live jsonb, and a text slice containing
  // something uuid-shaped is the only way that could ever misparse.
  const kindsPresent = [...new Set(first.items.map((i) => i.category))]
  console.log(`  kinds present: ${kindsPresent.join(', ')}`)
  for (const category of kindsPresent) {
    const kind = ATTENTION_KINDS.find((k) => k.category === category)!
    const of = first.items.filter((i) => i.category === category)
    const parsed = of.filter((i) => attentionRowId(i.id) !== null)
    if (kind.rowTable) {
      check(`${category}: all ${of.length} carry a readable row id`, parsed.length === of.length,
        `${parsed.length} of ${of.length}`)
    } else {
      check(`${category}: ${of.length} correctly refuse a row id`, parsed.length === 0,
        `${parsed.length} parsed when none should`)
    }
  }

  // The delete routes are offered on real rows, and point at rows that EXIST.
  // A 404 from a route the UI offered reads as the button being broken.
  console.log('\n── Delete targets point at rows that are really there ───────\n')
  const admin = createAdminClient()
  let checkedTargets = 0
  for (const item of first.items) {
    const target = attentionDeleteTarget(item.category, item.id)
    if (!target) continue
    const row = attentionRowId(item.id)!
    // `leads` is outside the generated Database type, so this reads untyped.
    const { count, error } = await (admin as unknown as {
      from: (t: string) => {
        select: (c: string, o: { count: 'exact'; head: true }) => {
          eq: (c: string, v: string) => Promise<{ count: number | null; error: { message: string } | null }>
        }
      }
    })
      .from(row.table)
      .select('id', { count: 'exact', head: true })
      .eq('id', row.rowId)
    check(`${item.category} → ${target.url} has a row behind it`, !error && count === 1,
      error?.message ?? `count ${count}`)
    checkedTargets++
    if (checkedTargets >= 6) break
  }
  if (checkedTargets === 0) {
    console.log('  (no deletable kinds on the list right now — nothing to check)')
  }

  console.log('\n── Dismiss, and both readers ────────────────────────────────\n')

  /*
    ⚠ A TASK, DELIBERATELY, BECAUSE A TASK IS COUNTED BY BOTH READERS. The badge
    head-counts `tasks`, `milestones`, `dd_items` and `certifications` — pick an
    item of any other kind and the badge assertion below would pass by being
    vacuous, which is §12's rule that a worked example whose figures coincide
    cannot distinguish two readings of the rule it illustrates.
  */
  const countedTables = new Set(['tasks', 'milestones', 'dd_items'])
  const subject =
    first.items.find((i) => {
      const row = attentionRowId(i.id)
      return row && countedTables.has(row.table)
    }) ?? first.items[0]
  const subjectCounted = countedTables.has(attentionRowId(subject.id)?.table ?? '')

  console.log(`  subject: ${subject.id} (${subject.category}) — "${subject.title.slice(0, 60)}"`)
  console.log(`  it is ${subjectCounted ? '' : 'NOT '}one the sidebar badge counts`)

  const badgeBefore = await countAttention()
  console.log(`  badge before: ${badgeBefore}`)

  await dismissAttentionItem({
    itemKey: subject.id,
    category: subject.category,
    title: subject.title,
    projectName: subject.project_name,
    projectId: subject.project_id,
    actor: 'verify-attention-dismiss',
  })
  written.push(subject.id)

  const after = await computeAttention()
  check('the item is gone from the list', !after.items.some((i) => i.id === subject.id))
  check('exactly one item left, not a whole kind', after.items.length === first.items.length - 1,
    `${first.items.length} → ${after.items.length}`)
  check('the summary total agrees with the rows it counted',
    after.summary.total === after.items.length, `${after.summary.total} vs ${after.items.length}`)

  // The per-kind summary must drop too — it is derived from `visible`, so a
  // filter applied after the counts were taken would show here.
  const kind = ATTENTION_KINDS.find((k) => k.category === subject.category)!
  const beforeOfKind = first.items.filter((i) => i.category === subject.category).length
  check(`the ${kind.summaryKey} count dropped by one`,
    (after.summary as unknown as Record<string, number>)[kind.summaryKey] === beforeOfKind - 1,
    `${beforeOfKind} → ${(after.summary as unknown as Record<string, number>)[kind.summaryKey]}`)

  check('it shows up on the dismissed list', after.dismissed.some((d) => d.item_key === subject.id))
  const stored = after.dismissed.find((d) => d.item_key === subject.id)
  check('the dismissed row kept the title a reader needs', stored?.title === subject.title)
  check('and who did it', stored?.dismissed_by === 'verify-attention-dismiss')
  check('and when it comes back', stored?.dismissed_until === dismissUntil())

  const badgeAfter = await countAttention()
  console.log(`  badge after: ${badgeAfter}`)
  if (subjectCounted) {
    check('⚠ the SIDEBAR BADGE dropped too, filtered in SQL', badgeAfter === badgeBefore - 1,
      `${badgeBefore} → ${badgeAfter}`)
  } else {
    check('the badge is unchanged, as this kind is not one it counts',
      badgeAfter === badgeBefore, `${badgeBefore} → ${badgeAfter}`)
  }

  console.log('\n── Twice is once ────────────────────────────────────────────\n')

  // ⚠ §12: pair every such pass with a script that calls it TWICE. The unique
  // index on `item_key` is what makes the second call an extension rather than
  // a duplicate row, and a duplicate would make the Dismissed view show the
  // same thing twice with two Restore buttons, only one of which works.
  const before2 = (await activeDismissals()).length
  await dismissAttentionItem({
    itemKey: subject.id,
    category: subject.category,
    title: subject.title,
    projectName: subject.project_name,
    projectId: subject.project_id,
    days: 30,
    actor: 'verify-attention-dismiss',
  })
  const dismissals2 = await activeDismissals()
  check('a second dismiss does not add a row', dismissals2.length === before2,
    `${before2} → ${dismissals2.length}`)
  check('it EXTENDS the quiet instead',
    dismissals2.find((d) => d.item_key === subject.id)?.dismissed_until === dismissUntil(30))

  console.log('\n── The SQL filter the badge depends on ──────────────────────\n')

  const byTable = dismissedRowIds(dismissals2)
  const row = attentionRowId(subject.id)
  check('the dismissal maps to its source table', row ? byTable.get(row.table)?.includes(row.rowId) === true : false,
    [...byTable.keys()].join(', '))

  // ⚠ A key with no row behind it must contribute NOTHING to this map, or the
  // badge would be handed `<uuid>-Sign the MNDA` as an id and PostgREST would
  // answer 22P02 on the whole count — which returns null, which reads as zero.
  const bogus = dismissedRowIds([
    {
      item_key: `waiting-${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}-Sign the MNDA`,
      category: 'stale_waiting',
      title: 'x',
      project_name: null,
      project_id: null,
      dismissed_until: dismissUntil(),
      dismissed_by: null,
      created_at: new Date().toISOString(),
    },
  ])
  check('a rowless key contributes no id to any table', bogus.size === 0,
    `${bogus.size} tables: ${[...bogus.keys()].join(', ')}`)

  console.log('\n── Restore ──────────────────────────────────────────────────\n')

  await restoreAttentionItem(subject.id)
  written.splice(written.indexOf(subject.id), 1)

  const back = await computeAttention()
  check('the item is back on the list', back.items.some((i) => i.id === subject.id))
  check('the list is the length it started at', back.items.length === first.items.length,
    `${first.items.length} → ${back.items.length}`)
  check('it is off the dismissed list', !back.dismissed.some((d) => d.item_key === subject.id))

  const badgeBack = await countAttention()
  check('the badge is back where it was', badgeBack === badgeBefore, `${badgeBefore} → ${badgeBack}`)

  // ⚠ IDEMPOTENT, BECAUSE TWO THINGS REACH IT. The Undo toast and the Restore
  // button on the Dismissed view both call this, and a reader can press both.
  await restoreAttentionItem(subject.id)
  check('restoring twice is not an error', true)

  console.log('\n── Containment (§8) ────────────────────────────────────────\n')

  /*
    ⚠ ASSERTED AGAINST A REAL PROTECTED PROJECT, BECAUSE A GUARD CHECKED WITH
    ZERO OF THEM PROVES NOTHING. Same lesson as the records-registry work on
    10-19: flip `confidential` mid-run rather than hoping one exists. A
    dismissal snapshots the item's TITLE, so a protected project's milestone
    would otherwise be readable by anyone on the Dismissed view.
  */
  const withProject = first.items.find((i) => i.project_id)
  if (!withProject) {
    console.log('  (no project-attached item on the list — containment not exercised)')
  } else {
    const projectId = withProject.project_id!
    const { data: proj } = await admin
      .from('projects')
      .select('id, name, confidential')
      .eq('id', projectId)
      .single()
    const wasConfidential = proj?.confidential ?? false

    await dismissAttentionItem({
      itemKey: withProject.id,
      category: withProject.category,
      title: withProject.title,
      projectName: withProject.project_name,
      projectId,
      actor: 'verify-attention-dismiss',
    })
    written.push(withProject.id)

    const open = await computeAttention()
    check(`"${proj?.name}" dismissal is visible while the project is not protected`,
      open.dismissed.some((d) => d.item_key === withProject.id))

    await admin.from('projects').update({ confidential: true }).eq('id', projectId)
    try {
      const locked = await computeAttention()
      check('⚠ the dismissal is WITHHELD once the project is protected',
        !locked.dismissed.some((d) => d.item_key === withProject.id))
      check('and so is the item itself, as it always was',
        !locked.items.some((i) => i.id === withProject.id))
      // The title is the thing that must not leak.
      const titles = locked.dismissed.map((d) => d.title).join('\n')
      check('the protected title appears nowhere in the dismissed list',
        !titles.includes(withProject.title))
    } finally {
      // ⚠ RESTORED WHATEVER HAPPENS. Leaving a live project `confidential`
      // would lock it out of every aggregate and need a psql round trip to
      // undo. Not a `process.exit` in here — §12: a `finally` that exits
      // swallows the throw it is unwinding.
      await admin.from('projects').update({ confidential: wasConfidential }).eq('id', projectId)
      console.log(`  (restored ${proj?.name} confidential=${wasConfidential})`)
    }
  }
}

try {
  await main()
} catch (err) {
  failures++
  console.error('\n  ✗ threw:', err instanceof Error ? err.message : err)
} finally {
  for (const key of written) {
    await restoreAttentionItem(key).catch(() => {})
  }
  if (written.length) console.log(`\n  (cleaned up ${written.length} dismissal${written.length === 1 ? '' : 's'})`)
}

console.log(failures === 0 ? '\n✓ the dismiss loop holds, from both readers\n' : `\n✗ ${failures} failed\n`)
process.exitCode = failures === 0 ? 0 : 1
