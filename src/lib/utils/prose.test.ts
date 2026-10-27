import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseProseBlocks, type ProseBlock } from './prose'

/**
 * ⚠ EVERY FIXTURE HERE IS A REAL LINE FROM `company_profile.about`, not a
 * line invented to suit the rules. The whole risk in this module is a parser
 * tuned to a corpus it was never shown, so the test is the corpus.
 */

const kinds = (blocks: ProseBlock[]) => blocks.map((b) => b.kind)

test('an eighty-underscore separator is a rule, not a paragraph of underscores', () => {
  const b = parseProseBlocks('Above\n' + '_'.repeat(80) + '\nBelow the line here.')
  assert.deepEqual(kinds(b), ['heading', 'rule', 'paragraph'])
  // Box-drawing and em-dash runs appear in the same corpus.
  assert.equal(parseProseBlocks('─'.repeat(12))[0].kind, 'rule')
  assert.equal(parseProseBlocks('========')[0].kind, 'rule')
  // But a short run is punctuation, not furniture.
  assert.equal(parseProseBlocks('---')[0].kind, 'paragraph')
})

test('a quote takes the attribution on the line below it', () => {
  const b = parseProseBlocks('"America is too great for small dreams."\n— President Ronald Reagan')
  assert.deepEqual(kinds(b), ['quote'])
  assert.equal(b[0].kind === 'quote' && b[0].text, 'America is too great for small dreams.')
  assert.equal(b[0].kind === 'quote' && b[0].attribution, 'President Ronald Reagan')
})

test('a dash-led line that follows no quote stays prose', () => {
  // ⚠ The attribution rule is the one most able to do damage: left open, any
  // em-dash sentence in the body becomes somebody's byline.
  const b = parseProseBlocks('The platform expands nationally.\n— and the corridor follows it.')
  // Two lines, two paragraphs — and crucially NEITHER is an attribution.
  assert.deepEqual(kinds(b), ['paragraph', 'paragraph'])
  const second = parseProseBlocks('"A quote."\n— One\n— Two')
  // The second dash cannot attach to an already-attributed quote.
  assert.equal(second.filter((x) => x.kind === 'quote').length, 1)
  assert.ok(second.some((x) => x.kind === 'paragraph'))
})

test('consecutive bullets become one list', () => {
  const b = parseProseBlocks(
    '• $1.6 trillion target in global construction market capture\n' +
      '• $39.5 billion planned in the Utah and Nevada corridor\n' +
      '• 600,000 jobs supported across the 11-state platform'
  )
  assert.deepEqual(kinds(b), ['list'])
  assert.equal(b[0].kind === 'list' && b[0].items.length, 3)
  assert.equal(b[0].kind === 'list' && b[0].items[0].startsWith('$1.6'), true)
})

test('a section title is a heading and a byline is not', () => {
  // The four lines this rule exists to tell apart, verbatim from the corpus.
  const b = parseProseBlocks(
    'BER WILSON LLC\n' +
      "Ericson Tua'one  |  Founder and CEO  |  South Jordan, Utah\n" +
      'Document Control: BW-BRG-2026-012\n' +
      'Three presidents. One mission. Ber Wilson is building it.'
  )
  assert.deepEqual(kinds(b), ['heading', 'paragraph', 'paragraph', 'paragraph'])
  assert.equal(b[0].kind === 'heading' && b[0].text, 'BER WILSON LLC')

  for (const title of ['The Platform', 'The Numbers', 'Where We Build', 'BUILDING FUTURES']) {
    assert.equal(parseProseBlocks(title)[0].kind, 'heading', title)
  }
})

test('consecutive lines are separate paragraphs, because this corpus does not wrap', () => {
  /*
    ⚠ THIS TEST REPLACED ONE I HAD INVENTED. The first version asserted that
    wrapped lines JOIN, which is what a hard-wrapped text file wants — and
    `company_profile.about` is not one. Its paragraphs are single lines of up
    to 190 characters, and a heading is followed IMMEDIATELY by its paragraph
    with no blank line between, so joining merged every section's two
    paragraphs into one. The fixture was the bug.
  */
  const b = parseProseBlocks(
    'The Platform\n' +
      'Ber Wilson is building a national platform of quantum-hardened rural smart cities.\n' +
      'This is the teaser. Additional sites will be shared at a later time.\n' +
      'The Numbers'
  )
  assert.deepEqual(kinds(b), ['heading', 'paragraph', 'paragraph', 'heading'])
})

test('empty input is an empty document, not a block containing nothing', () => {
  // §12: an empty population passes vacuously — say so explicitly.
  assert.deepEqual(parseProseBlocks(''), [])
  assert.deepEqual(parseProseBlocks('\n\n   \n'), [])
})
