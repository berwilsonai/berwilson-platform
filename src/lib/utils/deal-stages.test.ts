import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  STAGES, STAGE_PIPELINE, STAGE_CLOSED,
  STAGE_LABELS, STAGE_INDEX, STAGE_BADGE, STAGE_COLOR, STAGE_BORDER, STAGE_TEXT,
  STAGE_ENUM_FOR_PROMPT,
  isDealStage,
  WIN_BANDS, WIN_BAND_VALUE, WIN_BAND_LABELS, WIN_BAND_BADGE, WIN_BAND_COLOR,
  winBand, winBandLabel, pwinBadge, isWinBand,
} from './constants'
import { sourceFiles, stripComments } from '@/lib/ui/source-scan'

/**
 * The deal-stage and win-band vocabularies, held to themselves.
 *
 * Both were introduced on 2026-10-30 — one pipeline for projects AND
 * opportunities, replacing a seven-member defence-contracting enum on one
 * table and a nine-member text pipeline on the other, and Low/Medium/High in
 * place of a free-text percentage.
 *
 * ⚠ THE POINT OF THESE TESTS IS THE SECOND SCHEMA, NOT THE FIRST. `tsc` already
 * proves every `Record<DealStage, …>` map is complete — that is why the maps
 * are typed rather than derived (§12). What `tsc` cannot see is a vocabulary
 * RETYPED AS STRINGS somewhere else: the old stage list survived as
 * `string[]` in ProposalIntakeWizard, as a literal `['award', 'mobilization',
 * 'execution', 'closeout']` in ProjectCard, and in six prompt templates, all
 * of them green through typecheck, build and 917 tests. That is the class of
 * miss these assertions exist for.
 */

const STAGE_TOKENS = [
  'prospecting', 'in_discussions', 'due_diligence', 'contracting', 'won', 'lost',
] as const

/**
 * The vocabulary this replaced — the members that are UNAMBIGUOUS.
 *
 * ⚠ FIVE OF THE SEVEN ARE DELIBERATELY NOT LISTED, for the reason §12 gives:
 * where the values a check hunts are ordinary English words, no word search
 * can tell a taxonomy from a sentence. All five are live values in OTHER
 * vocabularies here — `'bid'` is a calendar event type AND a
 * document-classifier token, `'award'` is a timeline marker, `'execution'` and
 * `'mobilization'` are construction trade terms in the iMessage deal-term
 * list, and `'capture'` is inside `capture_lead`, a real column. The broad
 * version flagged sixteen files of which two were real.
 *
 * ⚠ AND THE NARROWING LOST NOTHING, which is the test worth doing before
 * trusting it: the broad version's two genuine finds were
 * `byStage[p.stage ?? 'pursuit']` in agent-tools and `projectPhase`'s
 * four-way comparison in map/constants, and `'pursuit'` catches the first
 * while `'closeout'` catches the second. A check with false positives is a
 * check somebody turns off.
 */
const RETIRED_STAGE_TOKENS = ['pursuit', 'closeout'] as const

/**
 * The opportunity pipeline this replaced — the members that are UNAMBIGUOUS.
 *
 * ⚠ FOUR OF THE NINE ARE DELIBERATELY NOT LISTED, and §12 says why: where the
 * values a check hunts are ordinary English words, no word search can tell a
 * taxonomy from a sentence. `identified`, `evaluating`, `negotiating` and
 * `agreement` are all live values in OTHER vocabularies here — the investor
 * relationship stages (`utils/investors.ts`), the document classifier
 * (`drive/classify.ts`), the personnel agreement kinds
 * (`governance/registers.ts`) — so hunting them flagged twelve files of which
 * only three were real.
 *
 * ⚠ THE NARROWING COST NOTHING, because the three that remain are enough: the
 * same scan still caught `status: 'identified'` in all three opportunity
 * producers via the broader pass, and `in_discussion` (singular — the project
 * side has always been plural), `closed_won` and `closed_passed` appear in no
 * other vocabulary in the repo. A check with false positives is a check
 * somebody turns off.
 */
const RETIRED_OPPORTUNITY_TOKENS = [
  'in_discussion', 'closed_won', 'closed_passed',
] as const

// ─── the vocabulary agrees with itself ───────────────────────────────────────

test('the six stages are exactly the enum, in pipeline order', () => {
  assert.deepEqual(STAGES, [...STAGE_TOKENS])
})

test('STAGE_INDEX is the position in STAGES — not a second ordering', () => {
  // Two orderings is the drift this file exists to prevent: a board sorted by
  // one and a progress bar filled by the other disagree about which stage is
  // "further along", and neither looks wrong on its own.
  STAGES.forEach((s, i) => assert.equal(STAGE_INDEX[s], i, `${s} is at ${i} in STAGES`))
})

test('the pipeline and the closed set partition the vocabulary', () => {
  // ⚠ NOT MERELY "both are subsets". Every stage must be in exactly one of
  // them, or a stage is either invisible on every board (in neither) or
  // rendered as both a live lane and a terminal chip (in both).
  const pipeline = new Set<string>(STAGE_PIPELINE)
  const closed = new Set<string>(STAGE_CLOSED)
  for (const s of STAGES) {
    const inPipeline = pipeline.has(s)
    const inClosed = closed.has(s)
    assert.ok(inPipeline !== inClosed, `${s} must be in exactly one of STAGE_PIPELINE / STAGE_CLOSED`)
  }
  assert.equal(pipeline.size + closed.size, STAGES.length)
})

test('won and lost are the terminal pair', () => {
  // Asserted by NAME, because this is the decision the whole split encodes:
  // `status` was narrowed to active/on_hold on the strength of it (§12 — an
  // assertion encodes a decision, not a law).
  assert.deepEqual([...STAGE_CLOSED].sort(), ['lost', 'won'])
})

test('every stage map covers every stage, with a non-empty value', () => {
  // `tsc` proves the KEYS. This proves the values are real strings — a map
  // typed `Record<DealStage, string>` accepts '' and renders unstyled.
  const maps = { STAGE_LABELS, STAGE_BADGE, STAGE_COLOR, STAGE_BORDER, STAGE_TEXT }
  for (const [name, map] of Object.entries(maps)) {
    for (const s of STAGES) {
      const v = (map as Record<string, string>)[s]
      assert.ok(v && v.trim().length > 0, `${name}[${s}] is empty`)
    }
  }
})

test('no two stages share a label', () => {
  const labels = STAGES.map((s) => STAGE_LABELS[s])
  assert.equal(new Set(labels).size, labels.length, `duplicate stage label in ${labels.join(', ')}`)
})

test('isDealStage accepts every member and refuses every retired one', () => {
  for (const s of STAGES) assert.ok(isDealStage(s), `${s} should be a stage`)
  for (const s of RETIRED_STAGE_TOKENS) assert.ok(!isDealStage(s), `${s} is retired`)
  for (const s of RETIRED_OPPORTUNITY_TOKENS) assert.ok(!isDealStage(s), `${s} is retired`)
  for (const junk of [null, undefined, '', 'Prospecting', 0, {}]) {
    assert.ok(!isDealStage(junk), `${String(junk)} is not a stage`)
  }
})

test('the prompt enumeration is generated from STAGES', () => {
  // §12: a taxonomy written into a prompt is a second schema and it drifts
  // silently, because a category the model was never told about never fires.
  assert.equal(STAGE_ENUM_FOR_PROMPT, STAGES.join(' | '))
  for (const s of STAGES) assert.ok(STAGE_ENUM_FOR_PROMPT.includes(s), `${s} missing from the prompt enumeration`)
})

// ─── nothing retypes the vocabulary ──────────────────────────────────────────

/**
 * Every source file, comments stripped and this file excluded.
 *
 * ⚠ BOTH HALVES MATTER (§12). A scan that keeps comments measures its own
 * documentation — the `⚠` notes added on 10-30 name `pursuit` and `capture`
 * precisely to explain why they are gone. A scan that includes itself reports
 * the arrays above as three violations.
 */
/**
 * The ONE file allowed to list the vocabulary outside `constants.ts`.
 *
 * ⚠ NAMED WITH ITS REASON, never absorbed by loosening the test (§12).
 * `src/types/database.ts` is written by `npm run gen-types` straight from the
 * live database — it is a transcript of the schema, not a second schema, and
 * it is the thing every other copy is supposed to agree WITH. Excluding it is
 * correct; excluding anything else is the drift this file exists to catch.
 */
const GENERATED = 'src/types/database.ts'

function liveSource(): Array<{ path: string; text: string }> {
  return sourceFiles()
    .filter((p) => !p.endsWith('deal-stages.test.ts') && !p.endsWith(GENERATED))
    .map((path) => ({ path, text: stripComments(readFileSync(path, 'utf8')) }))
}

test('the generated types still carry the vocabulary — the exemption is real', () => {
  /*
    ⚠ THE EXEMPTION IS ASSERTED, NOT ASSUMED. §12: a canary must outlive what
    it guards, and an exclusion nobody checks is how a test quietly stops
    testing. If `database.ts` ever stops naming these — a failed regeneration,
    a path change, a stubbed file — then `liveSource()` is excluding a file
    that no longer matters while this test keeps passing, and the real
    guarantee (that the generated types ARE the schema) has gone unnoticed.
  */
  const generated = readFileSync(GENERATED, 'utf8')
  for (const token of STAGE_TOKENS) {
    assert.ok(
      generated.includes(`"${token}"`),
      `${token} is missing from ${GENERATED} — re-run gen-types`
    )
  }
  for (const token of RETIRED_STAGE_TOKENS) {
    assert.ok(
      !generated.includes(`"${token}"`),
      `${token} is STILL in ${GENERATED} — the old enum was not dropped`
    )
  }
})

test('no live code names a retired project stage', () => {
  // ⚠ WHOLE TOKENS IN QUOTES, not substrings. §12: an anchored or unbounded
  // pattern is blind in one direction and over-eager in the other — `bid` is
  // inside `bid_due_date`, `bidDecision` and `forbidden`, and `capture` is
  // inside `capture_lead`, which is a live column. Only a QUOTED exact token
  // is a stage value.
  const offenders: string[] = []
  for (const { path, text } of liveSource()) {
    for (const token of RETIRED_STAGE_TOKENS) {
      if (new RegExp(`['"\`]${token}['"\`]`).test(text)) offenders.push(`${path}: '${token}'`)
    }
  }
  assert.deepEqual(offenders, [], `retired stage tokens still in live code:\n${offenders.join('\n')}`)
})

test('no live code names a retired opportunity status', () => {
  const offenders: string[] = []
  for (const { path, text } of liveSource()) {
    for (const token of RETIRED_OPPORTUNITY_TOKENS) {
      if (new RegExp(`['"\`]${token}['"\`]`).test(text)) offenders.push(`${path}: '${token}'`)
    }
  }
  assert.deepEqual(offenders, [], `retired opportunity tokens still in live code:\n${offenders.join('\n')}`)
})

test('constants.ts is the only module that lists the stages literally', () => {
  /*
    The ONE assertion that would have caught every miss on 10-30.

    A file "lists the stages" when it quotes three or more members as literals
    — three, because a pair appears legitimately (`['won', 'lost']` as a
    terminal set is a real thing to write, and STAGE_CLOSED is exactly that).
    Three adjacent members is an enumeration, and an enumeration outside the
    registry is a second schema.
  */
  const offenders: string[] = []
  for (const { path, text } of liveSource()) {
    if (path.endsWith('utils/constants.ts')) continue
    const named = STAGE_TOKENS.filter((t) => new RegExp(`['"\`]${t}['"\`]`).test(text))
    if (named.length >= 3) offenders.push(`${path}: ${named.join(', ')}`)
  }
  assert.deepEqual(offenders, [], `a second stage enumeration:\n${offenders.join('\n')}`)
})

// ─── win bands ───────────────────────────────────────────────────────────────

test('the three bands are low, medium, high', () => {
  assert.deepEqual([...WIN_BANDS], ['low', 'medium', 'high'])
})

test('every band map covers every band', () => {
  const maps = { WIN_BAND_VALUE, WIN_BAND_LABELS, WIN_BAND_BADGE, WIN_BAND_COLOR }
  for (const [name, map] of Object.entries(maps)) {
    for (const b of WIN_BANDS) {
      const v = (map as Record<string, unknown>)[b]
      assert.ok(v !== undefined && v !== '', `${name}[${b}] is empty`)
    }
  }
})

test('a band stores a percentage, and reading it back gives the same band', () => {
  /*
    ⚠ THE ROUND TRIP IS THE WHOLE DESIGN. The column stays `int4` so
    `weightedValue()` keeps working, which means the band is written as a
    number and re-derived on every read. If `WIN_BAND_VALUE` and `winBand`
    ever disagree, a human picks "High", the chip comes back saying "Medium",
    and nothing errors — the two have to be each other's inverse by test.
  */
  for (const b of WIN_BANDS) {
    assert.equal(winBand(WIN_BAND_VALUE[b]), b, `${b} stored as ${WIN_BAND_VALUE[b]} reads back wrong`)
  }
})

test('the three stored values are distinct and ordered', () => {
  const vals = WIN_BANDS.map((b) => WIN_BAND_VALUE[b])
  assert.equal(new Set(vals).size, 3, 'two bands store the same percentage')
  assert.deepEqual(vals, [...vals].sort((a, b) => a - b), 'the bands are not in ascending order')
  for (const v of vals) assert.ok(v > 0 && v <= 100, `${v} is not a percentage`)
})

test('not set is null, never a band', () => {
  // §12: a bare em dash at a value's own weight reads as a failed render, so
  // the caller has to be able to tell "no judgement" from "Low".
  assert.equal(winBand(null), null)
  assert.equal(winBand(undefined), null)
  assert.equal(winBandLabel(null), null)
})

test('an old free-text percentage still reads as one of the three', () => {
  /*
    ⚠ MEASURED, NOT CHOSEN. Two projects carried 80 and 99 from the free-text
    field this replaces, and both mean High. The boundaries have to be wide
    enough that any integer a human, an import or a brief ever wrote lands in
    a band — a value that returned null would render as "not set" and silently
    discard a real judgement.
  */
  assert.equal(winBand(80), 'high')
  assert.equal(winBand(99), 'high')
  assert.equal(winBand(0), 'low')
  assert.equal(winBand(100), 'high')
  for (let p = 0; p <= 100; p++) {
    assert.ok(isWinBand(winBand(p)), `${p}% fell outside every band`)
  }
})

test('a band always has a chip, including when unset', () => {
  // Never '': an empty class string renders an unstyled chip, which §12 notes
  // passes every typecheck and looks like a missing feature.
  for (const p of [null, 0, 20, 50, 80, 100]) {
    assert.ok(pwinBadge(p).trim().length > 0, `no chip for ${String(p)}`)
  }
})

test('win_probability is never printed as a raw percentage at a reader', () => {
  /*
    §12 — never print a stored enum at a reader, and a percentage that is
    really one of three bands is the same deception with more digits. Showing
    "20%" to somebody who chose "Low" asserts a precision they did not.

    Matches the two shapes that put the number on screen: a `${…}%` template
    around a win-probability variable, and a percentage width style driven by
    one. `weightedValue` is untouched — it is arithmetic, not a reader.
  */
  const offenders: string[] = []
  for (const { path, text } of liveSource()) {
    if (path.endsWith('utils/constants.ts')) continue
    if (/\$\{\s*win(?:Prob|_probability)[A-Za-z]*\s*\}%/.test(text)) offenders.push(`${path}: printed as a percentage`)
  }
  assert.deepEqual(offenders, [], `win probability rendered as a number:\n${offenders.join('\n')}`)
})
