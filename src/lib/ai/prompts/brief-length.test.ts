import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  RECORD_BRIEF_SYSTEM_PROMPT,
  RECORD_BRIEF_PROMPT_VERSION,
} from './record-brief'

/**
 * The record brief is a SUMMARY, and the prompt is what holds it to that.
 *
 * Richard, 2026-10-30: *"The executive summary is way too wordy. Be as concise
 * as possible just summarizing key information."* Measured at the time: 34
 * stored project briefs averaged 5,220 characters, the longest 6,460.
 *
 * ⚠ THESE ASSERT THE CONSTRAINT, NOT THE PROSE. The old prompt already said
 * "aim for something a busy executive reads in two minutes" and produced 850
 * words, because an instruction to be brief is advice and a per-section count
 * is a constraint. So what is checked here is that every section still carries
 * a countable limit — the thing that would quietly disappear the next time
 * somebody reworded this prompt.
 *
 * §12 — an assertion encodes a DECISION, not a law. The decision is that
 * concision is structural here. A later session that wants longer briefs
 * should change this test deliberately, not discover it in passing.
 */

test('the prompt states a whole-brief ceiling in words', () => {
  assert.match(
    RECORD_BRIEF_SYSTEM_PROMPT,
    /never exceed \d+ words/i,
    'the brief has no overall word ceiling — "be concise" is not one'
  )
  const ceiling = Number(/never exceed (\d+) words/i.exec(RECORD_BRIEF_SYSTEM_PROMPT)?.[1])
  assert.ok(
    ceiling > 0 && ceiling <= 500,
    `the ceiling is ${ceiling} words — above ~500 it is not a summary`
  )
})

test('every section carries a countable limit', () => {
  /*
    ⚠ SECTION BY SECTION, because a single overall ceiling is not enough: the
    model satisfies it by cutting whichever section comes last, and the last
    sections here are Open items and Next decision — the two a reader acts on.
    Each needs its own floor-and-ceiling so the cut lands on prose instead.
  */
  const limits: Array<[string, RegExp]> = [
    ['Bottom line', /## Bottom line\s*\nTWO sentences/],
    ['Where it stands', /## Where it stands\s*\nAT MOST FOUR bullets/],
    ['Recent movement', /## Recent movement\s*\nAT MOST FOUR bullets/],
    ['Risks', /## Risks\s*\nAT MOST FOUR bullets/],
    ['Open items', /## Open items\s*\nAT MOST FIVE bullets/],
    ['Not recorded', /## Not recorded\s*\nONE line/],
    ['Next decision', /## Next decision\s*\nONE sentence/],
  ]
  for (const [section, pattern] of limits) {
    assert.match(
      RECORD_BRIEF_SYSTEM_PROMPT,
      pattern,
      `"${section}" has no countable limit — it will grow back`
    )
  }
})

test('the limits say ONE LINE, not just a bullet count', () => {
  // Four bullets of a paragraph each is the 5,220-character brief again. The
  // bullet count alone was never the binding constraint.
  const oneLine = RECORD_BRIEF_SYSTEM_PROMPT.match(/ONE LINE each/g) ?? []
  assert.ok(
    oneLine.length >= 4,
    `only ${oneLine.length} sections cap the line length; a bullet can hold a paragraph`
  )
})

test('every honesty rule survived the shortening', () => {
  /*
    ⚠ THE POINT OF THIS TEST. Each of these seven is a wrong answer that was
    actually shipped — a brief that called a deal stalled because retrieval
    stopped at June, one that read an empty milestone table as a schedule with
    nothing overdue, one that invented a figure. Shortening the OUTPUT is not a
    reason to loosen the standard for what goes in it, and a rule deleted while
    "tidying a prompt" leaves no trace at all: the model simply stops being
    told, and the category never fires again (§12 — a taxonomy a model was
    never told about never fires).
  */
  const rules: Array<[string, RegExp]> = [
    ['recency is authoritative', /CONTACT RECENCY/],
    ['absence of a record is not absence of the thing', /Absence of a record is not absence of the thing/],
    ['filed versus merely matched', /matched, not yet filed/i],
    ['never invent a figure', /Never estimate a value, invent a deadline/],
    ['facts vs estimates vs judgements', /Distinguish FACTS .*ESTIMATES .*JUDGEMENTS/],
    ['no invented bracket labels', /no \[FACT\], no \[JUDGEMENT\]/],
    ['written for the ear', /Write for the ear/],
  ]
  for (const [rule, pattern] of rules) {
    assert.match(RECORD_BRIEF_SYSTEM_PROMPT, pattern, `the "${rule}" rule is gone`)
  }
  // Numbered 1..7, so a rule cannot be dropped without renumbering showing it.
  for (let n = 1; n <= 7; n++) {
    assert.ok(
      RECORD_BRIEF_SYSTEM_PROMPT.includes(`\n${n}. `),
      `rule ${n} is missing — the list is no longer 1..7`
    )
  }
})

test('the severity tags are still exactly three, and scoped to Risks', () => {
  for (const tag of ['[CRITICAL]', '[WATCH]', '[INFO]']) {
    assert.ok(RECORD_BRIEF_SYSTEM_PROMPT.includes(tag), `${tag} is missing`)
  }
  // The scoping sentence is what stops the tags appearing in Open items, where
  // a reader would take them for a second severity scheme.
  assert.match(
    RECORD_BRIEF_SYSTEM_PROMPT,
    /tags appear nowhere else in the brief/i,
    'nothing confines the severity tags to the Risks section'
  )
})

test('the prompt version was bumped with the rewrite', () => {
  /*
    ⚠ THE VERSION IS WHAT MAKES THE CHANGE TRACEABLE. Every call logs
    `prompt_version` to `ai_queries`, so a brief can be traced to the
    instructions that produced it — and without a bump, 5,220-character briefs
    and 1,500-character ones are indistinguishable in the log.

    ⚠ AND BUMPING IT DOES NOT REWRITE THE STORED ROWS (§12 — fixing a
    generator changes nothing the reader sees; the old rows carry the old
    text). `ProjectNarrativeBrief` regenerates any brief not written today, so
    the corpus turns over on its own as records are opened — but the 13 briefs
    already dated today had to be deleted by hand on 10-30 or they would have
    kept serving the long version indefinitely.
  */
  assert.match(RECORD_BRIEF_PROMPT_VERSION, /^record-brief-\d+\.\d+$/)
  assert.notEqual(
    RECORD_BRIEF_PROMPT_VERSION,
    'record-brief-1.1',
    'the prompt changed shape but kept the old version'
  )
})

test('the prompt names no live record', () => {
  /*
    §12 — a prompt example is training data, and an example naming a REAL
    record is printed as a fact: Pepper's note once quoted its own prompt as
    work she had done. This prompt has no examples, which is the safest state;
    this asserts it stays that way as sections get reworded.
  */
  for (const name of ['Steelton', 'TensorIQ', 'GridEdge', 'Cleveland', 'Myton', 'Delta', 'Whiskey']) {
    assert.ok(
      !RECORD_BRIEF_SYSTEM_PROMPT.includes(name),
      `the prompt names the live record "${name}" — it will be read as a fact`
    )
  }
})
