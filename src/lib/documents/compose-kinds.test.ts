/**
 * The registry of documents Ber AI can write.
 *
 * The property worth locking is not the contents of the list but that it has
 * exactly ONE home. The thing being replaced is the `draft` tool's hand-written
 * `kind: 'email' | 'agenda' | 'report'` — three values that had already drifted
 * against 20 measured asks before anyone counted them, because a hand-written
 * enumeration beside a registry drifts and a ⚠ comment saying so does not stop
 * the next one (§12).
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  COMPOSE_KINDS,
  COMPOSE_KIND_KEYS,
  COUNSEL_NOTICE,
  composeKind,
  composeKindList,
  composeKindMenu,
} from './compose-kinds'

test('every kind is complete — a half-filled row would ship a blank document', () => {
  for (const [key, spec] of Object.entries(COMPOSE_KINDS)) {
    assert.match(key, /^[a-z][a-z0-9_]*$/, `${key} is not a usable key`)
    assert.ok(spec.label.trim().length > 0, `${key} has no label`)
    assert.ok(spec.description.trim().length > 0, `${key} has no description`)
    assert.ok(spec.docType.trim().length > 0, `${key} has no docType`)
    assert.ok(spec.fileNoun.trim().length > 0, `${key} has no fileNoun`)
    // The guidance IS the prompt for this kind. A short one produces a document
    // shaped like nothing in particular.
    assert.ok(spec.guidance.trim().length > 80, `${key} has guidance too thin to steer on`)
    assert.ok(['routine', 'needs_counsel'].includes(spec.legal), `${key} has no legal weight`)
    assert.equal(typeof spec.usesFigures, 'boolean', `${key} does not say about figures`)
  }
})

test('a kind this build does not know is refused by name, not guessed at', () => {
  assert.equal(composeKind('nonsense'), null)
  assert.equal(composeKind(''), null)
  assert.equal(composeKind(null), null)
  assert.equal(composeKind(undefined), null)
})

test('a key off Object.prototype is not a document kind', () => {
  // `hasOwnProperty` against a fixed map, matching `getChild` in
  // src/lib/records/children.ts: a crafted body cannot reach a prototype member.
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(composeKind(key), null, `${key} resolved to a kind`)
  }
})

test('the list is the declaration order, which is the reading order', () => {
  assert.deepEqual(
    composeKindList().map((k) => k.key),
    Object.keys(COMPOSE_KINDS)
  )
  assert.deepEqual(COMPOSE_KIND_KEYS, Object.keys(COMPOSE_KINDS))
})

test('THE PROMPT ENUMERATION IS GENERATED FROM THE SAME MAP', () => {
  // §12: a taxonomy written into a prompt is a second schema and it drifts
  // silently, because a category the model was never told about simply never
  // fires. Adding a kind must change the prompt with no second edit.
  const menu = composeKindMenu()
  for (const [key, spec] of Object.entries(COMPOSE_KINDS)) {
    assert.ok(menu.includes(key), `${key} is missing from the prompt menu`)
    assert.ok(menu.includes(spec.label), `${spec.label} is missing from the prompt menu`)
  }
  assert.equal(menu.split('\n').length, COMPOSE_KIND_KEYS.length)
})

test('a legally consequential kind exists, and says so in one voice', () => {
  const needsCounsel = composeKindList().filter(({ spec }) => spec.legal === 'needs_counsel')
  // An offer to purchase and a term sheet are the two the measured asks wanted
  // most; if either stops being flagged, that is a decision to make out loud.
  assert.deepEqual(needsCounsel.map((k) => k.key).sort(), ['offer', 'term_sheet'])
  assert.match(COUNSEL_NOTICE, /not been reviewed by counsel/)
  assert.match(COUNSEL_NOTICE, /not legal advice/)
})

test('a kind that asks for [TO BE AGREED] never also invites an estimate', () => {
  for (const [key, spec] of Object.entries(COMPOSE_KINDS)) {
    const g = spec.guidance.toLowerCase()
    assert.ok(
      !/\b(estimate|approximate|assume)\b/.test(g),
      `${key} invites the model to estimate — the figure guard will refuse what it writes`
    )
  }
})

/**
 * ⚠ THE DRIFT TEST, AND IT EXCLUDES ITSELF.
 *
 * §12: a test that scans the source tree must STRIP COMMENTS and EXCLUDE
 * ITSELF, or it measures its own documentation — the only two hits for `focus:`
 * in this repo are docblocks explaining why it is banned. This file names every
 * key in its own assertions, so counting itself would always fail.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('NOTHING OUTSIDE THE REGISTRY ENUMERATES THE KINDS', () => {
  const home = join('src', 'lib', 'documents', 'compose-kinds.ts')
  const self = join('src', 'lib', 'documents', 'compose-kinds.test.ts')

  /**
   * ⚠ MATCHED BY SHAPE, NOT BY WORD, AND TWO FALSE POSITIVES FORCED THAT.
   *
   * §12: a static check for a shape like this gets broader and wronger — narrow
   * it until it has no false positives. Both earlier versions were wronger:
   *
   *   v1, any quoted key → flagged `src/lib/utils/investors.ts`, which carries
   *   `'term_sheet'` as an InvestmentStage, a negotiation stage on a
   *   capital-raise commitment.
   *
   *   v2, two or more quoted keys → flagged `src/lib/drive/classify.ts`, whose
   *   `'offer'`, `'proposal'` and `'agenda'` are match TOKENS for sorting an
   *   incoming file name into a Drive subfolder.
   *
   * Both are honest English nouns in unrelated code, which is the lesson: these
   * keys are ordinary words and a word search can never tell a taxonomy from a
   * sentence. A SECOND ENUMERATION has a shape — a TypeScript union member or
   * an object key — so that is what is matched, and it still takes two to
   * count, because one is a coincidence and a set is a copy.
   */
  const unionMember = (key: string) => new RegExp("\\|\\s*['\"`]" + key + "['\"`]")
  const objectKey = (key: string) => new RegExp("(^|[{,\\s])" + key + "\\s*:", 'm')

  const offenders: string[] = []
  for (const file of sourceFiles('src')) {
    if (file === home || file === self) continue
    const code = stripComments(readFileSync(file, 'utf8'))
    const named = COMPOSE_KIND_KEYS.filter(
      (key) => unionMember(key).test(code) || objectKey(key).test(code)
    )
    if (named.length >= 2) offenders.push(`${file} → ${named.join(', ')}`)
  }

  assert.deepEqual(
    offenders,
    [],
    `a second enumeration of the document kinds has appeared:\n${offenders.join('\n')}`
  )
})
