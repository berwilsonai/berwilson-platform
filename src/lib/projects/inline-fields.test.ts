import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  INLINE_SPECS,
  INLINE_FIELD_NAMES,
  coerceInlineValue,
  inlineEditValue,
  isInlineField,
  type InlineFieldName,
} from './inline-fields'
import {
  STAGES, STATUSES, SECTORS,
  WIN_BANDS, WIN_BAND_VALUE, WIN_BAND_LABELS,
} from '@/lib/utils/constants'
import type { TablesUpdate } from '@/lib/supabase/types'

/**
 * The inline-edit spec, held to the schema and to itself.
 *
 * This table is the whitelist for `PATCH /api/projects/[id]` AND the renderer's
 * instructions, so an error here is either a 500 in an unattended place or a
 * column a browser can write that nobody meant it to.
 */

// ─── the keys are real columns ───────────────────────────────────────────────

test('every field is a real, writable `projects` column', () => {
  /*
    ⚠ THE ASSERTION IS AGAINST THE GENERATED TYPE, NOT A LIST.

    §12: a registry entry for a column that does not exist is worse than a
    typo, because the update fails at runtime inside whatever is calling it and
    the only symptom is that a field is never written. The provenance registry
    learned this the hard way — its first draft named four columns that do not
    exist, all written from memory rather than from the schema.

    `TablesUpdate<'projects'>` comes from `gen-types`, which asserts it reached
    THIS database and covered every live table, so this check is compile-time
    AND re-derived on every regeneration. A typo'd key stops the build.
  */
  const probe: Required<Pick<TablesUpdate<'projects'>, InlineFieldName>> =
    {} as Required<Pick<TablesUpdate<'projects'>, InlineFieldName>>
  assert.ok(probe !== null)
  assert.ok(INLINE_FIELD_NAMES.length > 0, 'the spec is empty')
})

test('the dangerous columns are deliberately absent', () => {
  /*
    ⚠ ASSERTED, BECAUSE THE ABSENCE IS THE DECISION and a decision kept only
    in a comment is one the next person adds a field past. §12 — an assertion
    encodes a decision, not a law; rewrite it stronger rather than deleting it.

    `confidential` is containment, and containment must not share a path with
    ordinary editing. `name` re-keys every alias, Drive folder path and learned
    meeting title pointing at the record. `parent_project_id` changes what a
    program's value sums over. `match_aliases` is a fact that reaches every
    matcher. None of these belongs behind a double-click.
  */
  for (const forbidden of ['confidential', 'name', 'parent_project_id', 'match_aliases', 'id']) {
    assert.ok(!isInlineField(forbidden), `${forbidden} must not be inline-editable`)
  }
})

test('every spec is internally consistent', () => {
  for (const name of INLINE_FIELD_NAMES) {
    const spec = INLINE_SPECS[name]
    assert.ok(spec.label.trim().length > 0, `${name} has no label`)
    const needsOptions = spec.kind === 'select' || spec.kind === 'band'
    assert.equal(
      Boolean(spec.options?.length),
      needsOptions,
      `${name} is a ${spec.kind} — options are ${needsOptions ? 'required' : 'meaningless'}`
    )
    for (const o of spec.options ?? []) {
      assert.ok(o.value.length > 0 && o.label.trim().length > 0, `${name} has a blank option`)
    }
  }
})

test('the option lists come from the registry, not from this module', () => {
  // The whole reason the 10-30 rename was a ten-file change: a vocabulary
  // retyped is a vocabulary that drifts (§12).
  const values = (n: InlineFieldName) => INLINE_SPECS[n].options?.map((o) => o.value)
  assert.deepEqual(values('stage'), [...STAGES])
  assert.deepEqual(values('status'), [...STATUSES])
  assert.deepEqual(values('sector'), [...SECTORS])
  assert.deepEqual(values('win_probability'), [...WIN_BANDS])
})

// ─── what may and may not be emptied ─────────────────────────────────────────

test('the NOT NULL columns refuse to be emptied, by name', () => {
  /*
    ⚠ `sector` IS NOT NULL WITH NO DEFAULT — an explicit null is `23502`, which
    fails the WHOLE update and discards every other field in it (§12). `stage`
    is NOT NULL with a default, so it cannot be nulled either. The refusal has
    to be a sentence a reader can act on, not a 500.
  */
  for (const name of ['sector', 'stage'] as const) {
    const r = coerceInlineValue(name, '')
    assert.equal(r.ok, false, `${name} must refuse an empty value`)
    if (!r.ok) {
      assert.match(r.error, /cannot be emptied/, `${name}'s refusal must say why`)
      assert.ok(
        r.error.includes(INLINE_SPECS[name].label),
        `${name}'s refusal must name the field, not the column`
      )
    }
  }
})

test('every clearable field accepts every shape of empty', () => {
  const clearable = INLINE_FIELD_NAMES.filter((n) => INLINE_SPECS[n].clearable)
  assert.ok(clearable.length > 0)
  for (const name of clearable) {
    for (const empty of ['', '   ', null, undefined]) {
      const r = coerceInlineValue(name, empty)
      assert.equal(r.ok, true, `${name} should clear on ${JSON.stringify(empty)}`)
      if (r.ok) assert.equal(r.value, null, `${name} must clear to NULL, not ''`)
    }
  }
})

// ─── coercion ────────────────────────────────────────────────────────────────

test('a select refuses a value outside its options and names the options', () => {
  // The error has to carry the LABELS, because the alternative is a bare 500
  // from `22P02` which tells the reader nothing (§12).
  const r = coerceInlineValue('stage', 'pursuit')
  assert.equal(r.ok, false, 'a retired stage must be refused')
  if (!r.ok) assert.match(r.error, /Prospecting/, 'the refusal must list what is allowed')
})

test('a select accepts every one of its own options', () => {
  for (const name of INLINE_FIELD_NAMES) {
    const spec = INLINE_SPECS[name]
    if (spec.kind !== 'select') continue
    for (const o of spec.options ?? []) {
      const r = coerceInlineValue(name, o.value)
      assert.equal(r.ok, true, `${name} rejected its own option ${o.value}`)
      if (r.ok) assert.equal(r.value, o.value)
    }
  }
})

test('a band is stored as its percentage, and reads back as the same band', () => {
  /*
    ⚠ THE ROUND TRIP IS THE DESIGN. The column is `int4` so `weightedValue()`
    keeps working, which means the band is written as a number and re-derived
    on every read. If these two ever disagree a human picks "High", the chip
    comes back "Medium", and nothing errors anywhere.
  */
  for (const band of WIN_BANDS) {
    const r = coerceInlineValue('win_probability', band)
    assert.equal(r.ok, true, `${band} should be accepted`)
    if (r.ok) {
      assert.equal(r.value, WIN_BAND_VALUE[band], `${band} stored wrong`)
      assert.equal(
        inlineEditValue('win_probability', r.value),
        band,
        `${band} does not read back as itself`
      )
    }
  }
})

test('a band refuses a raw percentage, which is what the old field took', () => {
  // Pasting "80" into this field used to be legal. It must now be refused
  // rather than silently stored, or the picker and the column disagree about
  // what the column means.
  for (const junk of ['80', 80, 'High', 'LOW']) {
    const r = coerceInlineValue('win_probability', junk)
    assert.equal(r.ok, false, `${String(junk)} must be refused`)
    if (!r.ok) {
      assert.match(r.error, new RegExp(WIN_BAND_LABELS.low), 'the refusal must name the bands')
    }
  }
})

test('money accepts what a person types and refuses what it cannot mean', () => {
  for (const [typed, stored] of [
    ['12500', 12500],
    ['$12,500', 12500],
    ['  12500  ', 12500],
    ['12500.49', 12500],
    ['12500.51', 12501],
  ] as const) {
    const r = coerceInlineValue('estimated_value', typed)
    assert.equal(r.ok, true, `${typed} should parse`)
    if (r.ok) assert.equal(r.value, stored, `${typed} parsed wrong`)
  }
  for (const junk of ['-5', 'about 12k', 'NaN', 'Infinity', '12,5,0,0abc']) {
    assert.equal(coerceInlineValue('estimated_value', junk).ok, false, `${junk} must be refused`)
  }
})

test('a date must be a date, not whatever the control sent', () => {
  assert.equal(coerceInlineValue('bid_due_date', '2026-11-04').ok, true)
  for (const junk of ['11/04/2026', '2026-11-4', 'next Tuesday', '2026-11-04T00:00:00Z']) {
    assert.equal(coerceInlineValue('bid_due_date', junk).ok, false, `${junk} must be refused`)
  }
})

test('text is trimmed, so a stray space is not a change', () => {
  const r = coerceInlineValue('location', '  Eagle Mountain, UT  ')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.value, 'Eagle Mountain, UT')
})

test('every field coerces something — no kind falls through to undefined', () => {
  /*
    ⚠ §12: a trailing `else` turns a missing arm into a write against another
    table's route, and a prefix discriminator is a registry with no type behind
    it — so walk EVERY member rather than trusting the switch to be total.
    `coerceInlineValue` returns `undefined` for an unhandled kind, which would
    then be sent to Postgres as a missing column value.
  */
  const sample: Record<string, unknown> = {
    text: 'x', textarea: 'x', money: '1', date: '2026-01-01',
  }
  for (const name of INLINE_FIELD_NAMES) {
    const spec = INLINE_SPECS[name]
    const raw =
      spec.kind === 'select' || spec.kind === 'band'
        ? spec.options?.[0]?.value
        : sample[spec.kind]
    const r = coerceInlineValue(name, raw)
    assert.notEqual(r, undefined, `${name} (${spec.kind}) fell through the switch`)
    assert.equal(r.ok, true, `${name} rejected a legal sample value`)
  }
})

test('isInlineField refuses anything that is not a key', () => {
  for (const name of INLINE_FIELD_NAMES) assert.ok(isInlineField(name))
  for (const junk of [null, undefined, '', 'toString', 'constructor', 0, {}]) {
    assert.ok(!isInlineField(junk), `${String(junk)} is not a field`)
  }
})
