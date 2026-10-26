/**
 * THE REASONING KNOB'S DEFAULT IS THE WHOLE SAFETY PROPERTY.
 *
 * `reasoning_effort: 'none'` makes the mechanical passes 6-9x faster by
 * skipping a reasoning pass that is 87-98% of every generation. It also made a
 * hard classification WRONG in the spot check that found it. So the only thing
 * standing between "a measured speedup" and "a quietly worse platform" is that
 * an undeclared prompt keeps thinking — which is a property of two lines of
 * mapping code, and therefore a property worth a test.
 *
 * ⚠ The declarations themselves are a hand-written enumeration with no registry
 * behind it (the same shape §12 warns about), so this file also asserts that
 * every prompt module declaring a version declares a reasoning choice beside
 * it. A prompt that gains a call site and forgets the declaration would
 * otherwise inherit nothing and simply never be measured.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { wireReasoning, type PromptReasoning } from './reasoning'

describe('wireReasoning', () => {
  it("maps 'think' to undefined so the parameter is OMITTED, not pinned", () => {
    // Not `'default'`, not `'auto'`: the request must come out byte-for-byte
    // what it was before the option existed, or every unmeasured prompt has
    // quietly changed behaviour on a server default we do not control.
    assert.equal(wireReasoning('think'), undefined)
  })

  it("maps 'none' to the wire value", () => {
    assert.equal(wireReasoning('none'), 'none')
  })

  it('has exactly two members, so a third cannot be added without a decision', () => {
    // A scale is tempting and measured useless here: 'low' came back at 39s/859
    // tokens against 37s/~900 for the default. If a future model makes a middle
    // setting real, this assertion is the place that says so out loud.
    const all: PromptReasoning[] = ['think', 'none']
    assert.deepEqual(
      all.map(wireReasoning),
      [undefined, 'none'],
      'every member of PromptReasoning must have a defined wire mapping'
    )
  })
})

describe('the reasoning parameter reaches the wire only when asked for', () => {
  const local = readFileSync('src/lib/ai/local.ts', 'utf8')

  it('sends reasoning_effort conditionally, never unconditionally', () => {
    assert.match(
      local,
      /\.\.\.\(options\.reasoning === 'none' \? \{ reasoning_effort: 'none' \} : \{\}\)/,
      'reasoning_effort must be spread in only for the none case'
    )
  })

  it('counts reasoning from BOTH field spellings the server might use', () => {
    // `reasoning_content` is a server convention, not part of the OpenAI
    // schema. Reading only one name would report 0 and read exactly like a
    // model that does not think — the failure mode that hid this cost for four
    // months in the first place.
    assert.match(local, /delta\.reasoning_content \?\? delta\.reasoning/)
  })

  it('never puts reasoning into the answer text', () => {
    // The count exists so the cost is legible. The content must not leak into
    // `text`, where a caller would parse it as the answer.
    const stream = local.slice(local.indexOf('const reasoningDelta'))
    const assignment = stream.slice(0, stream.indexOf('if (delta.content)'))
    assert.ok(
      !/text \+=/.test(assignment),
      'reasoning deltas must only be counted, never appended to text'
    )
  })
})

describe('every prompt that declares a version declares a reasoning choice', () => {
  // Modules holding a *_PROMPT_VERSION constant that is passed to callGemini.
  // Listed rather than globbed because a version constant is not by itself
  // evidence of a local model call — several are written into jsonb instead.
  const DECLARED: Array<[string, string]> = [
    ['src/lib/ai/prompts/thread-summary.ts', 'THREAD_SUMMARY_REASONING'],
    ['src/lib/ai/prompts/drive-filing.ts', 'DRIVE_FILING_REASONING'],
    ['src/lib/ai/prompts/intake-predecide.ts', 'INTAKE_PREDECIDE_REASONING'],
    ['src/lib/commitments/prompt.ts', 'COMMITMENT_REASONING'],
    ['src/lib/commitments/chase.ts', 'CHASE_REASONING'],
    ['src/lib/ai/document-pipeline.ts', 'DOC_SUMMARY_REASONING'],
  ]

  for (const [file, name] of DECLARED) {
    it(`${name} is declared and typed in ${file}`, () => {
      const src = readFileSync(file, 'utf8')
      assert.match(
        src,
        new RegExp(`export const ${name}: PromptReasoning = '(think|none)'`),
        `${name} must be declared with an explicit PromptReasoning value`
      )
    })
  }

  it('each declaration is wired to a call site, not left decorative', () => {
    // §12: a curated vocabulary only a picker reads is decoration. A
    // declaration no call site passes is the same thing — it would read as a
    // measured decision while the pass it describes keeps thinking.
    const SITES: Array<[string, string]> = [
      ['src/lib/email-sweep/summarize-phase.ts', 'THREAD_SUMMARY_REASONING'],
      ['src/lib/drive/classify.ts', 'DRIVE_FILING_REASONING'],
      ['src/lib/email-ingestion/predecide.ts', 'INTAKE_PREDECIDE_REASONING'],
      ['src/lib/commitments/extract-phase.ts', 'COMMITMENT_REASONING'],
      ['src/lib/commitments/chase.ts', 'CHASE_REASONING'],
    ]
    for (const [file, name] of SITES) {
      const src = readFileSync(file, 'utf8')
      assert.match(
        src,
        new RegExp(`reasoning: wireReasoning\\(${name}\\)`),
        `${file} must pass ${name} to callGemini`
      )
    }
  })

  it('drive filing pairs its reasoning-off with a candidate enum', () => {
    // These two are ONE decision. Reasoning-off was measured correct 4-5/8
    // against a human's confirmed filing; with the candidate list as an enum it
    // reached 6/8, level with reasoning on, because the enum removes the
    // failure mode (it "corrected" a folder genuinely misspelled in Drive).
    // Dropping the schema while leaving `'none'` would silently restore the
    // worse arm, and no type can express that pairing — so it is asserted here.
    const choice = readFileSync('src/lib/ai/prompts/drive-filing.ts', 'utf8')
    const site = readFileSync('src/lib/drive/classify.ts', 'utf8')
    if (/export const DRIVE_FILING_REASONING: PromptReasoning = 'none'/.test(choice)) {
      assert.match(
        site,
        /folder: \{ type: \['string', 'null'\], enum: \[\.\.\.decidable, null\] \}/,
        'DRIVE_FILING_REASONING is \'none\', so the candidate enum must be sent with it'
      )
    }
  })

  it('the document pass takes its choice as a travelling parameter', () => {
    // Its prompt is a PARAMETER, and one of its fourteen callers overrides it
    // (`/api/opportunities/documents`, opp-doc-summary-1.0), so the choice has
    // to travel with the prompt. Defaulting an override to the doc-summary
    // declaration would apply one prompt's measurement to another.
    const src = readFileSync('src/lib/ai/document-pipeline.ts', 'utf8')
    assert.match(
      src,
      /input\.reasoning \?\? \(input\.promptVersion \? 'think' : DOC_SUMMARY_REASONING\)/,
      'an overriding caller must default to think, not to the doc-summary choice'
    )
  })
})
