/**
 * Merging a staged session onto an existing record.
 *
 * ⚠ THESE TESTS EXIST BECAUSE HALF OF resolveMergeTarget WAS UNREACHABLE CODE.
 * It has read `opportunity_name` / `opportunity_id` off a candidate since it was
 * written, but `findMatchingProjects` — the only producer of those candidates on
 * this path — searched `projects` only and had no field for an opportunity. So
 * the opportunity branch could never fire, no opportunity could ever be a merge
 * target, and the pre-decide model (which may only choose from the closed list
 * of candidate NAMES it is shown) said `create` instead: measured 2026-10-16,
 * 110 of 126 pending sessions, at 0.93 average confidence, against a register
 * holding 7 live opportunities. The producer was fixed on 2026-10-17
 * (findMatchingRecords, with includeOpportunities) and these lock the consumer.
 *
 * The function is deliberately NOT a fuzzy match: the model chose from a closed
 * list, so the name it returned either IS one of those candidates or it was
 * invented — and inventing is precisely the case that must not resolve.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveMergeTarget } from './merge-target'

const PROJECT = {
  kind: 'project',
  project_id: 'p-1',
  project_name: 'Steelton — Cleveland-Cliffs (PA)',
  opportunity_id: null,
  opportunity_name: null,
  score: 0.55,
  match_reasons: ['record_name_shared_word:steelton'],
  extracted_project_index: 0,
}
const OPPORTUNITY = {
  kind: 'opportunity',
  project_id: null,
  project_name: null,
  opportunity_id: 'o-1',
  opportunity_name: 'GridEdge',
  score: 0.55,
  match_reasons: ['record_name_shared_word:gridedge'],
  extracted_project_index: 0,
}

const merge = (name: string) => ({ disposition: 'merge', merge_target_name: name })

test('an OPPORTUNITY resolves — the branch that could never fire before', () => {
  const r = resolveMergeTarget(merge('GridEdge'), [OPPORTUNITY])
  assert.equal(r.ok, true)
  assert.ok(r.ok)
  assert.equal(r.opportunityId, 'o-1')
  assert.equal(r.projectId, null)
  assert.equal(r.name, 'GridEdge')
})

test('a project still resolves, and the two kinds do not bleed into each other', () => {
  const r = resolveMergeTarget(merge('Steelton — Cleveland-Cliffs (PA)'), [PROJECT, OPPORTUNITY])
  assert.ok(r.ok)
  assert.equal(r.projectId, 'p-1')
  assert.equal(r.opportunityId, null)
})

test('the name is matched WHOLE and case-insensitively, never as a substring', () => {
  assert.ok(resolveMergeTarget(merge('gridedge'), [OPPORTUNITY]).ok)
  assert.ok(resolveMergeTarget(merge('  GridEdge  '), [OPPORTUNITY]).ok)
  // A substring must NOT resolve: "Grid" is not the record, and a matcher that
  // accepts it files a conversation onto the wrong deal (§12).
  assert.equal(resolveMergeTarget(merge('Grid'), [OPPORTUNITY]).ok, false)
})

test('a name the model invented does not resolve', () => {
  const r = resolveMergeTarget(merge('GridEdge Modular Data Center Partnership'), [OPPORTUNITY])
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.reason.includes('not one of this session'))
})

test('two records answering to one name refuse rather than pick', () => {
  const twin = { ...OPPORTUNITY, opportunity_id: 'o-2' }
  const r = resolveMergeTarget(merge('GridEdge'), [OPPORTUNITY, twin])
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.reason.includes('more than one record'))
})

test('a session not recommended for merging refuses, whatever its candidates', () => {
  for (const d of ['create', 'dismiss', undefined]) {
    const r = resolveMergeTarget({ disposition: d, merge_target_name: 'GridEdge' }, [OPPORTUNITY])
    assert.equal(r.ok, false, String(d))
  }
})

test('a missing or empty target name refuses instead of taking the only candidate', () => {
  // The one candidate is RIGHT THERE, and taking it would be the §12 error:
  // one match is not a unique match, it is an unchallenged one.
  for (const n of [undefined, null, '', '   ']) {
    const r = resolveMergeTarget({ disposition: 'merge', merge_target_name: n }, [OPPORTUNITY])
    assert.equal(r.ok, false, String(n))
  }
})

test('a malformed candidate list is tolerated, not thrown on', () => {
  // match_candidates is jsonb and predates several shape changes.
  for (const bad of [null, undefined, 'nonsense', 42, [null], [{}], [{ project_name: 'X' }]]) {
    const r = resolveMergeTarget(merge('GridEdge'), bad)
    assert.equal(r.ok, false)
  }
})
