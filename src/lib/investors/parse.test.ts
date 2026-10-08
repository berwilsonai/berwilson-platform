/**
 * An investment's three target columns must always agree with the database
 * CHECK, because the alternative is a 500 the reader reads as their own mistake.
 *
 * `investments_target_check` (20261008000001) allows exactly three shapes:
 *   company → project_id null, spv_id null
 *   project → project_id set,  spv_id null
 *   spv     → project_id null, spv_id set
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { INVESTMENT_TARGETS, parseInvestmentFields } from './parse'
import {
  INVESTMENT_TARGET_KINDS,
  INVESTMENT_TARGET_LABELS,
  investmentTargetLabel,
  isInvestmentTargetKind,
} from '@/lib/utils/investors'

function fields(body: Record<string, unknown>) {
  const result = parseInvestmentFields(body)
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  return result.ok ? result.fields : null!
}

test('the default target is the parent company, with neither target column set', () => {
  const f = fields({})
  assert.equal(f.target_kind, 'company')
  assert.equal(f.project_id, null)
  assert.equal(f.spv_id, null)
})

test('a project target carries the project and never a vehicle', () => {
  const f = fields({ target_kind: 'project', project_id: 'p-1' })
  assert.equal(f.project_id, 'p-1')
  assert.equal(f.spv_id, null)
})

test('an spv target carries the vehicle and leaves project_id NULL', () => {
  // The deal is reached THROUGH the vehicle. A second copy of "which deal" is a
  // second definition that can drift — and it is the only way a commitment can
  // attach to an OPPORTUNITY at all, since `investments` has no
  // `opportunity_id`.
  const f = fields({ target_kind: 'spv', spv_id: 's-1' })
  assert.equal(f.spv_id, 's-1')
  assert.equal(f.project_id, null)
})

test('switching an spv commitment back to the company CLEARS the vehicle', () => {
  // The regression that would otherwise 500: the form still holds the old
  // spv_id, and `target_kind='company' AND spv_id IS NOT NULL` fails the CHECK.
  const f = fields({ target_kind: 'company', spv_id: 's-1', project_id: 'p-1' })
  assert.equal(f.spv_id, null)
  assert.equal(f.project_id, null)
})

test('switching an spv commitment to a project clears the vehicle too', () => {
  const f = fields({ target_kind: 'project', project_id: 'p-1', spv_id: 's-1' })
  assert.equal(f.project_id, 'p-1')
  assert.equal(f.spv_id, null)
})

test('an spv target with no vehicle is refused with a sentence, not a 500', () => {
  const result = parseInvestmentFields({ target_kind: 'spv' })
  assert.equal(result.ok, false)
  assert.ok(!result.ok && result.error.toLowerCase().includes('vehicle'))
})

test('a project target with no project is refused', () => {
  const result = parseInvestmentFields({ target_kind: 'project' })
  assert.equal(result.ok, false)
})

test('an unknown target kind is refused rather than defaulted', () => {
  // Silently defaulting would file a commitment against the parent company
  // when the caller meant a vehicle, which is a wrong record rather than an
  // error anybody sees.
  const result = parseInvestmentFields({ target_kind: 'entity' })
  assert.equal(result.ok, false)
})

test('an empty amount is null, never 0', () => {
  // $0 committed and nobody having said are different facts about a raise.
  const f = fields({ amount_committed: '', amount_funded: '0' })
  assert.equal(f.amount_committed, null)
  assert.equal(f.amount_funded, 0, 'an explicit zero is still a zero')
})

test('a percentage above 100 is refused', () => {
  const result = parseInvestmentFields({ equity_pct: 120 })
  assert.equal(result.ok, false)
})

// ── the label every screen shares ───────────────────────────────────────────
//
// Four screens wrote their own `target_kind === 'company' ? … : project?.name
// ?? 'Project'`, and every one of them rendered an SPV commitment as the bare
// word "Project" — because `project_id` is NULL on an spv-targeted row by
// design, so the fallback was the branch that always fired.

test('an SPV commitment is named by its vehicle AND its deal', () => {
  assert.equal(
    investmentTargetLabel({
      target_kind: 'spv',
      project: null,
      vehicle: { label: 'Delta LandCo', dealName: 'Delta Industrial Campus' },
    }),
    'Delta LandCo — Delta Industrial Campus',
    'the vehicle alone says nothing across fifty deals; the deal alone loses the structure'
  )
})

test('an SPV commitment NEVER falls through to the word "Project"', () => {
  // The regression: project_id is null, so a `?? 'Project'` fallback fires.
  const label = investmentTargetLabel({ target_kind: 'spv', project: null, vehicle: null })
  assert.notEqual(label, 'Project')
  assert.ok(label.toLowerCase().includes('protected'), label)
})

test('a project commitment with no project name says so in words', () => {
  // A bare em dash or an empty string at a value's own weight reads as a
  // failed render (§12).
  assert.equal(
    investmentTargetLabel({ target_kind: 'project', project: null }),
    'An unnamed project'
  )
})

test('the parent company ignores any vehicle left on the row', () => {
  assert.equal(
    investmentTargetLabel({
      target_kind: 'company',
      vehicle: { label: 'Delta LandCo', dealName: 'Delta' },
    }),
    'Ber Wilson (parent)'
  )
})

test('the target members match the parser and the database CHECK', () => {
  // Three copies of one taxonomy: this list, INVESTMENT_TARGETS in parse.ts,
  // and investments_target_check. A member one copy was never told about never
  // fires, which is how `spv` would have been offered by the form and filtered
  // out of every list.
  assert.deepEqual([...INVESTMENT_TARGET_KINDS].sort(), [...INVESTMENT_TARGETS].sort())
  for (const kind of INVESTMENT_TARGET_KINDS) {
    assert.ok(isInvestmentTargetKind(kind))
    assert.ok(INVESTMENT_TARGET_LABELS[kind], `${kind} has a label`)
  }
  assert.equal(isInvestmentTargetKind('entity'), false)
})
