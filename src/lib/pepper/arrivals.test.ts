import { test } from 'node:test'
import assert from 'node:assert/strict'

import { arrivedSince, arrivedClause } from './memory'
import { PEPPER_NOTE_SYSTEM_PROMPT } from './prompt'

/**
 * What is NEW in the morning note.
 *
 * The note was held on 2026-10-21 because *"the content isn't really helpful at
 * this point"*. Read back, the last one sent was almost entirely the standing
 * ledger: three of fourteen bullets said "this is the fifth morning I've raised
 * them" and two sections ended "Another 30 behind these." Against 199 open
 * commitments it sampled ten and counted the rest, so one morning read exactly
 * like the last. This marker is what lets it lead with what changed.
 */

test('an item created since the last note is new; one created before is not', () => {
  const since = '2026-10-28T09:00:00.000Z'
  assert.equal(arrivedSince('2026-10-28T14:00:00.000Z', since), true)
  assert.equal(arrivedSince('2026-10-27T23:59:59.000Z', since), false)
  // The boundary belongs to the newer side: an item created at the instant the
  // window opens has not been reported yet.
  assert.equal(arrivedSince(since, since), true)
})

test('⚠ THE TWO ISO FORMATS COMPARE CORRECTLY — the bug a string compare would hide', () => {
  /*
    `sinceIso` comes from `Date.toISOString()` and ends in `Z`; `created_at`
    comes back from PostgREST with a `+00:00` offset. Lexicographically `+`
    (0x2B) sorts BEFORE `Z` (0x5A), so two representations of the SAME instant
    compare the wrong way round under `>=` on the raw strings. Parsing is what
    makes this right, and this test is what stops someone "simplifying" it back.
  */
  const since = '2026-10-28T09:00:00.000Z'
  const sameInstant = '2026-10-28T09:00:00.000+00:00'
  assert.equal(arrivedSince(sameInstant, since), true)
  // And a genuinely earlier row in the offset format is still excluded.
  assert.equal(arrivedSince('2026-10-28T08:59:59.000+00:00', since), false)
  // Sanity: the naive comparison this guards against really does disagree.
  assert.equal(sameInstant >= since, false, 'the raw string compare is wrong, which is the point')
})

test('a missing or unparseable timestamp is never called new', () => {
  // §12: a provenance line that invents a provenance is worse than no line.
  // Telling the reader something is new when nothing says so is exactly that.
  const since = '2026-10-28T09:00:00.000Z'
  assert.equal(arrivedSince(null, since), false)
  assert.equal(arrivedSince('not a date', since), false)
  assert.equal(arrivedSince('2026-10-28T14:00:00.000Z', 'not a date'), false)
})

test('the clause is the exact marker the prompt is written against', () => {
  // The prompt keys "## New since I last wrote" off this string and is told
  // never to print it verbatim. If the two drift, the section silently empties.
  const since = '2026-10-28T09:00:00.000Z'
  assert.equal(arrivedClause('2026-10-29T06:00:00.000Z', since), ', NEW SINCE THE LAST NOTE')
  assert.equal(arrivedClause('2026-10-01T06:00:00.000Z', since), '')
  assert.equal(arrivedClause(null, since), '')
})

test('⚠ THE PROMPT ILLUSTRATES WITH SHAPES, NEVER WITH A RECORD THAT EXISTS', () => {
  /*
    §12: a prompt example is training data, and a stale one is a lie the model
    repeats with confidence.

    Measured 2026-10-29. The records-line rule read: *"I filled in three contact
    titles and set Weirton's location from Tuesday's thread."* The model printed
    that sentence VERBATIM into Richard's note as a statement of what it had
    done — naming a real project and a real weekday — while the actual changes
    were three company names, two emails and a phone number on six different
    people. The reader had no way to know the sentence was invented, in the one
    line of the note that reports what Pepper altered unattended without asking.

    `Weirton` and `Steelton` are both live records here, which is exactly what
    made the example copyable. A name in this prompt is either a shape or a lie.
  */
  const names = ['Weirton', 'Steelton', 'Myton', 'Riverdale', 'GridEdge', 'Tooele']
  const found = names.filter((n) => PEPPER_NOTE_SYSTEM_PROMPT.includes(n))
  assert.deepEqual(found, [], `the prompt names live records, which the model will copy as fact: ${found.join(', ')}`)

  // And the rule that generalises it must still be there.
  assert.ok(
    PEPPER_NOTE_SYSTEM_PROMPT.includes('EVERY EXAMPLE IN THESE RULES IS A SHAPE, NEVER A FACT'),
    'the general rule against copying examples has been removed'
  )
})

test('the prompt still names the marker the renderer emits', () => {
  // The two are a contract with nothing type-checking it: `arrivedClause`
  // writes this string and the prompt keys its section off it. Renaming either
  // alone silently empties the section — §12, an untyped string contract.
  assert.ok(PEPPER_NOTE_SYSTEM_PROMPT.includes('NEW SINCE THE LAST NOTE'))
  assert.ok(PEPPER_NOTE_SYSTEM_PROMPT.includes('## New since I last wrote'))
  assert.ok(arrivedClause('2026-10-29T06:00:00.000Z', '2026-10-28T09:00:00.000Z').includes('NEW SINCE THE LAST NOTE'))
})
