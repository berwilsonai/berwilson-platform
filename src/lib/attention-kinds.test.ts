import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ATTENTION_KINDS,
  attentionCategoryForKey,
  attentionDeleteTarget,
  attentionHref,
  attentionKind,
  attentionRowId,
  urgencyBand,
} from './attention-kinds'
import { isTone } from './ui/tone'

/**
 * These exist to stop the failure §12 records twice: a hand-written enumeration
 * beside a registry drifts, and `/decide` shipped a kind that got a count and
 * no chip because of it. The summary's field names are a derived TYPE, so a
 * mismatch there is a compile error; what still needs asserting is everything
 * the type system cannot see — uniqueness, a real tone, and a destination.
 */

test('every category and summary key is unique', () => {
  const cats = ATTENTION_KINDS.map((k) => k.category)
  const keys = ATTENTION_KINDS.map((k) => k.summaryKey)
  assert.equal(new Set(cats).size, cats.length, 'duplicate category')
  assert.equal(new Set(keys).size, keys.length, 'duplicate summaryKey')
})

test('every kind names a real tone', () => {
  // A tone is resolved through src/lib/ui/tone.ts, which throws on an unknown
  // name — but it throws at RENDER, on whichever screen happens to show that
  // kind first. Here it fails at build time instead.
  for (const k of ATTENTION_KINDS) {
    assert.ok(isTone(k.tone), `${k.category} has tone "${k.tone}", which is not in the palette`)
  }
})

test('every kind has a label a reader can read', () => {
  for (const k of ATTENTION_KINDS) {
    assert.ok(k.label.length > 2, k.category)
    // Never print a stored enum at a reader (§12).
    assert.ok(!k.label.includes('_'), `${k.category}'s label looks like a column name`)
  }
})

test('every kind resolves a destination, with and without a project', () => {
  // The null case is not hypothetical: investor, Dino and lead items are not
  // project children at all, so every arm has to tolerate it. A kind with no
  // arm would fall out of the switch as undefined and render href="undefined".
  for (const k of ATTENTION_KINDS) {
    for (const projectId of ['11111111-1111-1111-1111-111111111111', null]) {
      const href = attentionHref(k.category, projectId)
      assert.equal(typeof href, 'string', `${k.category} / ${projectId}`)
      assert.ok(href.startsWith('/'), `${k.category} -> ${href} is not an internal path`)
      assert.ok(!href.includes('undefined') && !href.includes('null'), `${k.category} -> ${href}`)
    }
  }
})

test('attentionKind throws on a category it does not know', () => {
  for (const k of ATTENTION_KINDS) assert.equal(attentionKind(k.category).label, k.label)
  // @ts-expect-error — deliberately outside the union
  assert.throws(() => attentionKind('invented_kind'), /Unknown attention category/)
})

test('the urgency bands partition the whole 0-100 range', () => {
  // A score with no band would render unstyled, which reads as "not urgent".
  for (let u = 0; u <= 100; u++) {
    const b = urgencyBand(u)
    assert.ok(['now', 'soon', 'watch'].includes(b), `${u} -> ${b}`)
  }
  assert.equal(urgencyBand(100), 'now')
  assert.equal(urgencyBand(75), 'now')
  assert.equal(urgencyBand(74), 'soon')
  assert.equal(urgencyBand(50), 'soon')
  assert.equal(urgencyBand(49), 'watch')
  assert.equal(urgencyBand(0), 'watch')
})

test('the four past-a-date kinds lead the registry, because the list is ranked', () => {
  // The chip row renders in declaration order (§12: make the declaration order
  // the reading order), so the kinds a reader is most likely to act on must not
  // sit behind the softer signals.
  const first4 = ATTENTION_KINDS.slice(0, 4).map((k) => k.category)
  assert.deepEqual(first4, [
    'overdue_action',
    'critical_dd',
    'approaching_milestone',
    'expiring_compliance',
  ])
})

/* ── Quick actions, 10-20 ──────────────────────────────────────────────── */

/**
 * The prefix registry, held to what `computeAttention()` actually emits.
 *
 * ⚠ A PREFIX DISCRIMINATOR IS A REGISTRY WITH NO TYPE BEHIND IT, AND THIS
 * CODEBASE HAS ALREADY PAID FOR THAT ONCE. §12, 10-19: a fourth recording door
 * needed an arm in THREE separate prefix switches, 15 of 16 live checks passed,
 * and the meeting sat `unfiled` under a correctly linked thread because an
 * unrecognised prefix fell through to a default. The lasting fix there was a
 * test that loops every member across every switch rather than fixing them one
 * failure at a time, and this is the same test for the same shape.
 *
 * The id formats below are COPIED FROM src/lib/attention.ts, one per `id:`
 * site in the ten item-building blocks, so a renamed prefix fails here instead
 * of silently making a row undismissable.
 */

/**
 * One sample key per shape the engine builds, with the category that built it.
 * `null` for a rowId means the key carries no bare uuid — see `stale_waiting`.
 */
const UUID = '4f48f348-39b6-4d5a-9a98-92218501fd05'

const EMITTED: { key: string; category: string; rowId: string | null; table: string | null }[] = [
  // `id: \`task-${t.id}\``
  { key: `task-${UUID}`, category: 'overdue_action', rowId: UUID, table: 'tasks' },
  // `id: \`waiting-${u.id}-${item.text?.slice(0, 20)}\`` — an update's jsonb entry
  { key: `waiting-${UUID}-Sign the MNDA`, category: 'stale_waiting', rowId: null, table: null },
  // `id: \`milestone-${m.id}\``
  { key: `milestone-${UUID}`, category: 'approaching_milestone', rowId: UUID, table: 'milestones' },
  // `id: \`dd-${dd.id}\``
  { key: `dd-${UUID}`, category: 'critical_dd', rowId: UUID, table: 'dd_items' },
  // `id: \`comp-${c.id}\``
  { key: `comp-${UUID}`, category: 'expiring_compliance', rowId: UUID, table: 'compliance_items' },
  // `id: \`decision-${u.id}-${d.text.slice(0, 20)}\``
  { key: `decision-${UUID}-Push to 1 Nov`, category: 'stale_decision', rowId: null, table: null },
  // `id: \`dep-${dep.id}\``
  { key: `dep-${UUID}`, category: 'dependency_risk', rowId: UUID, table: 'project_dependencies' },
  // `id: \`investor-next-${inv.id}\`` and `id: \`investor-cold-${inv.id}\`` — ONE
  // category, TWO prefixes. A single-prefix assumption leaves half of these
  // unparseable, which is why `idPrefixes` is a list.
  { key: `investor-next-${UUID}`, category: 'investor_followup', rowId: UUID, table: 'investors' },
  { key: `investor-cold-${UUID}`, category: 'investor_followup', rowId: UUID, table: 'investors' },
  // `id: \`dino-payment-${p.id}\``
  { key: `dino-payment-${UUID}`, category: 'dino_payment', rowId: UUID, table: 'dino_payments' },
  // ⚠ NO `lead-` ENTRY: inbound leads left this registry on 2026-10-21, because
  // a bid invitation is inbound work awaiting a call and /decide owns that.
  // `attention.ts` no longer emits the prefix either — see the note at the foot
  // of ATTENTION_KINDS. This list is asserted to cover every id the engine
  // emits, so if the lead block ever comes back without a registry entry, the
  // coverage test below is what says so.
]

test('every id shape the engine emits resolves to the kind that built it', () => {
  for (const e of EMITTED) {
    assert.equal(
      attentionCategoryForKey(e.key),
      e.category,
      `${e.key} must resolve to ${e.category} — a key that resolves to nothing cannot be ` +
        'dismissed, and one that resolves to the WRONG kind would offer another kind\'s delete route'
    )
  }
})

test('every registry kind is covered by a sample above', () => {
  const covered = new Set(EMITTED.map((e) => e.category))
  for (const kind of ATTENTION_KINDS) {
    assert.ok(
      covered.has(kind.category),
      `${kind.category} has no sample key here. A kind added to the registry without one is a ` +
        'row whose quick actions nothing has ever exercised — add its `id:` format from ' +
        'src/lib/attention.ts'
    )
  }
})

test('every sample key starts with one of its own kind\'s declared prefixes', () => {
  for (const e of EMITTED) {
    const kind = ATTENTION_KINDS.find((k) => k.category === e.category)
    assert.ok(kind, `${e.category} is not in the registry`)
    assert.ok(
      kind.idPrefixes.some((p) => e.key.startsWith(p)),
      `${e.key} matches none of ${e.category}'s prefixes (${kind.idPrefixes.join(', ')})`
    )
  }
})

test('no prefix is a prefix of another kind\'s prefix', () => {
  // The lookup takes the LONGEST match, so an overlap would not silently
  // misroute today — but it would make the registry's reading order load-bearing
  // in a way nothing states, which is how `bldg`/`building` and `title`/
  // `Entitlements` went wrong (§12).
  const all = ATTENTION_KINDS.flatMap((k) => k.idPrefixes.map((p) => ({ p, c: k.category })))
  for (const a of all) {
    for (const b of all) {
      if (a.p === b.p && a.c === b.c) continue
      if (a.c === b.c) continue
      assert.ok(
        !b.p.startsWith(a.p),
        `"${b.p}" (${b.c}) starts with "${a.p}" (${a.c}) — two kinds would contend for one key`
      )
    }
  }
})

test('a key with no bare uuid behind it is REFUSED, not mangled', () => {
  for (const e of EMITTED) {
    const row = attentionRowId(e.key)
    if (e.rowId === null) {
      assert.equal(
        row,
        null,
        `${e.key} has no row of its own (it is an entry inside an updates jsonb array). ` +
          'Stripping the prefix yields "<uuid>-Sign the MNDA", which must never reach a DELETE'
      )
      continue
    }
    assert.ok(row, `${e.key} should resolve to a row`)
    assert.equal(row.rowId, e.rowId)
    assert.equal(row.table, e.table)
    assert.equal(row.category, e.category)
  }
})

test('garbage is refused rather than guessed at', () => {
  assert.equal(attentionCategoryForKey('nonsense-123'), null)
  assert.equal(attentionCategoryForKey(''), null)
  // Right prefix, wrong payload: not a uuid, so no route is offered.
  assert.equal(attentionRowId('task-not-a-uuid'), null)
  assert.equal(attentionRowId(`task-${UUID}x`), null)
})

test('delete is offered on exactly the three kinds that have an honest row', () => {
  const offered = ATTENTION_KINDS.filter((k) => k.deletable).map((k) => k.category).sort()
  assert.deepEqual(
    offered,
    ['critical_dd', 'expiring_compliance', 'overdue_action'],
    'Adding a fourth is a deliberate decision about a destructive verb, not a refactor. ' +
      'Milestones and dependencies are withheld on purpose (see the registry comments), and ' +
      'stale_waiting/stale_decision have no row at all.'
  )
})

test('a delete target names the route that already owns the row', () => {
  // ⚠ NOT A ROUTE ASSEMBLED FROM A TABLE NAME. §12: a second routing table
  // drifting beside the real one is how `/decide` went wrong. Each of these is
  // an existing handler with its own record-level guard, enum checks and
  // activity_log attribution — which is the whole reason the delete goes
  // through it rather than straight to Postgres.
  assert.deepEqual(attentionDeleteTarget('overdue_action', `task-${UUID}`), {
    url: `/api/tasks/${UUID}`,
    noun: 'task',
  })
  assert.deepEqual(attentionDeleteTarget('critical_dd', `dd-${UUID}`), {
    url: `/api/records/dd-items/${UUID}`,
    noun: 'diligence item',
  })
  assert.deepEqual(attentionDeleteTarget('expiring_compliance', `comp-${UUID}`), {
    url: `/api/records/compliance-items/${UUID}`,
    noun: 'compliance item',
  })
})

test('a kind with no delete returns null, so no button is rendered', () => {
  assert.equal(attentionDeleteTarget('approaching_milestone', `milestone-${UUID}`), null)
  assert.equal(attentionDeleteTarget('dependency_risk', `dep-${UUID}`), null)
  assert.equal(attentionDeleteTarget('stale_waiting', `waiting-${UUID}-x`), null)
  assert.equal(attentionDeleteTarget('investor_followup', `investor-next-${UUID}`), null)
  assert.equal(attentionDeleteTarget('dino_payment', `dino-payment-${UUID}`), null)
})

test('a delete target refuses a key belonging to a DIFFERENT kind', () => {
  // The category and the key both arrive from the row, but they arrive
  // separately — §12: a new record type is a destination for the human, never a
  // classification for the model, and seeding a target from one source's kind
  // and another's id sent an opportunity's uuid to the projects branch. Here it
  // would send a lead's uuid to /api/tasks.
  // ⚠ `lead-` IS NO LONGER ANY KIND'S PREFIX — inbound leads left this registry
  // on 2026-10-21 (see the note at the foot of ATTENTION_KINDS). Kept as a case
  // precisely because it is now an unknown prefix, which is the shape §12 warns
  // about: an unrecognised discriminator must refuse, never fall through to a
  // default arm.
  assert.equal(attentionDeleteTarget('overdue_action', `lead-${UUID}`), null)
  assert.equal(attentionDeleteTarget('critical_dd', `task-${UUID}`), null)
})
