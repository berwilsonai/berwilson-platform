/**
 * An investment's target columns must always agree with the database CHECK,
 * because the alternative is a 500 the reader reads as their own mistake.
 *
 * `investments_target_check` allows exactly two shapes as of 2026-10-23, when
 * the `spv` target went with the Vehicles module:
 *   company → project_id null
 *   project → project_id set
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

test('the default target is the parent company, with no target column set', () => {
  const f = fields({})
  assert.equal(f.target_kind, 'company')
  assert.equal(f.project_id, null)
})

test('a project target carries the project', () => {
  const f = fields({ target_kind: 'project', project_id: 'p-1' })
  assert.equal(f.project_id, 'p-1')
})

test('switching a project commitment back to the company CLEARS the project', () => {
  // The regression that would otherwise 500: the form still holds the old
  // project_id, and `target_kind='company' AND project_id IS NOT NULL` fails
  // the CHECK. The target columns travel together on every partial write.
  const f = fields({ target_kind: 'company', project_id: 'p-1' })
  assert.equal(f.project_id, null)
})

test('a project target with no project is refused', () => {
  const result = parseInvestmentFields({ target_kind: 'project' })
  assert.equal(result.ok, false)
})

test('an unknown target kind is refused rather than defaulted', () => {
  // Silently defaulting would file a commitment against the parent company
  // when the caller meant a deal, which is a wrong record rather than an error
  // anybody sees. `spv` is now one of these: a body still sending the retired
  // member is refused in words, not quietly booked against the parent.
  assert.equal(parseInvestmentFields({ target_kind: 'entity' }).ok, false)
  assert.equal(parseInvestmentFields({ target_kind: 'spv' }).ok, false)
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
// ?? 'Project'`. A label that is wrong in four places is a label with no owner,
// which is why it stays shared even now the union is down to two members.

test('a project commitment with no project name says so in words', () => {
  // A bare em dash or an empty string at a value's own weight reads as a
  // failed render (§12).
  assert.equal(
    investmentTargetLabel({ target_kind: 'project', project: null }),
    'An unnamed project'
  )
})

test('the parent company ignores any project left on the row', () => {
  assert.equal(
    investmentTargetLabel({ target_kind: 'company', project: { name: 'Delta' } }),
    'Ber Wilson (parent)'
  )
})

test('the target members match the parser and the database CHECK', () => {
  // Three copies of one taxonomy: this list, INVESTMENT_TARGETS in parse.ts,
  // and investments_target_check. A member one copy was never told about never
  // fires, which is how `spv` would have been offered by the form and filtered
  // out of every list — and is why removing it had to be done in all three.
  assert.deepEqual([...INVESTMENT_TARGET_KINDS].sort(), [...INVESTMENT_TARGETS].sort())
  for (const kind of INVESTMENT_TARGET_KINDS) {
    assert.ok(isInvestmentTargetKind(kind))
    assert.ok(INVESTMENT_TARGET_LABELS[kind], `${kind} has a label`)
  }
  assert.equal(isInvestmentTargetKind('entity'), false)
  assert.equal(isInvestmentTargetKind('spv'), false, 'the retired member must not resolve')
})
