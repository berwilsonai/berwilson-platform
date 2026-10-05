/**
 * The form spec and the engine must not drift.
 *
 * A revenue line type with no form is invisible in the UI while working
 * perfectly in the arithmetic, and a form field naming a column the whitelist
 * does not allow silently discards whatever the reader typed. Neither failure
 * reports itself anywhere, which is why they are asserted here.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { COLLECTIONS } from './collections'
import { LINE_COMMON_FIELDS, LINE_FORM_FIELDS } from './line-fields'
import { REVENUE_LINE_TYPES } from './types'

test('every revenue line type the engine knows has a form', () => {
  for (const type of REVENUE_LINE_TYPES) {
    const fields = LINE_FORM_FIELDS[type]
    assert.ok(fields, `${type} has no form, so it can never be entered`)
    assert.ok(fields.length > 0, `${type} has an empty form`)
  }
})

test('the form spec names no type the engine does not know', () => {
  for (const type of Object.keys(LINE_FORM_FIELDS)) {
    assert.ok(
      (REVENUE_LINE_TYPES as readonly string[]).includes(type),
      `${type} has a form but no formula`
    )
  }
})

test('every field in every form is in the write whitelist', () => {
  const allowed = new Set(Object.keys(COLLECTIONS.lines.fields))
  for (const [type, fields] of Object.entries(LINE_FORM_FIELDS)) {
    for (const field of fields) {
      assert.ok(
        allowed.has(field.name),
        `${type}.${field.name} is not in COLLECTIONS.lines.fields, so it would be silently discarded`
      )
    }
  }
  for (const field of LINE_COMMON_FIELDS) {
    assert.ok(allowed.has(field.name), `common field ${field.name} is not in the whitelist`)
  }
})

test('every select offers exactly the values the column permits', () => {
  const enums = COLLECTIONS.lines.enums ?? {}
  for (const [type, fields] of Object.entries(LINE_FORM_FIELDS)) {
    for (const field of fields) {
      if (field.kind !== 'select') continue
      assert.ok(field.options && field.options.length > 0, `${type}.${field.name} has no options`)
      const permitted = enums[field.name]
      if (!permitted) continue
      for (const option of field.options) {
        assert.ok(
          permitted.includes(option.value),
          // A stale option names a value the CHECK refuses, so the reader picks
          // it and the save fails with a constraint error they cannot act on.
          `${type}.${field.name} offers "${option.value}", which the column refuses`
        )
      }
    }
  }
})

test('no form field is listed twice for one type', () => {
  for (const [type, fields] of Object.entries(LINE_FORM_FIELDS)) {
    const names = fields.map((f) => f.name)
    assert.equal(
      new Set(names).size,
      names.length,
      `${type} lists a field twice, so it would render two inputs writing the same column`
    )
  }
})
