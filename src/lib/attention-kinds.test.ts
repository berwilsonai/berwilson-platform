import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ATTENTION_KINDS, attentionHref, attentionKind, urgencyBand } from './attention-kinds'
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
