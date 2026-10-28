import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeQuery, slugify } from './saved'

/*
  The two pure halves of a saved view.

  `normalizeQuery` is the one that matters: it decides whether the chip says
  "you are looking at this view". Get it wrong and the highlight is either
  never on, or on while the reader has since changed a facet — which is the
  chip claiming something untrue about what is on screen.
*/

test('key order never makes two identical filter sets look different', () => {
  assert.equal(
    normalizeQuery('stage=capture&sector=infrastructure'),
    normalizeQuery('sector=infrastructure&stage=capture')
  )
})

test('the view label is stripped, so saving twice cannot nest it', () => {
  // Saving while a view is selected would otherwise store `view=` inside the
  // stored query, and selecting it again would append a second one.
  assert.equal(normalizeQuery('view=active&sector=prefab'), 'sector=prefab')
  assert.equal(normalizeQuery('view=active'), '')
})

test('an empty value is not a filter', () => {
  // `?sector=&status=active` is what a facet reset leaves behind; treating the
  // blank as a filter would make an unfiltered list look saveable.
  assert.equal(normalizeQuery('sector=&status=active'), 'status=active')
  assert.equal(normalizeQuery('sector=&status='), '')
})

test('a leading question mark is accepted', () => {
  assert.equal(normalizeQuery('?status=active'), 'status=active')
})

test('slugify produces a url-safe slug', () => {
  assert.equal(slugify('Active Infrastructure'), 'active-infrastructure')
  assert.equal(slugify('  Won / Closed  '), 'won-closed')
  assert.equal(slugify('Tua’one’s deals'), 'tua-one-s-deals')
})

test('slugify never returns an empty slug', () => {
  /*
    ⚠ AN EMPTY SLUG WOULD COLLIDE WITH THE NEXT ONE and trip the (path, slug)
    unique constraint, which the route reports as "a view called … already
    exists" — a refusal naming a cause that is not the cause. A name of pure
    punctuation or of a script with no Latin transliteration reduces to
    nothing, so there is a random fallback.
  */
  for (const name of ['!!!', '———', '日本語', '...']) {
    const slug = slugify(name)
    assert.ok(slug.length > 0, `${name} produced an empty slug`)
    assert.match(slug, /^[a-z0-9-]+$/, `${name} produced an unsafe slug: ${slug}`)
  }
})

test('slugify is bounded, so a long name cannot make an unwieldy URL', () => {
  assert.ok(slugify('x'.repeat(200)).length <= 48)
})
