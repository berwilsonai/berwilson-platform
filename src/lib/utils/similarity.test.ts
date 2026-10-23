/**
 * Token-set similarity — the one home for what had quietly become two copies.
 *
 * The property worth locking is the CHOICE of metric. Jaccard and the overlap
 * coefficient agree on most pairs and disagree exactly where it matters, so a
 * future edit "simplifying" the denominator would pass every test that only
 * checked identical and disjoint sets.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { jaccard, phraseTokens } from './similarity'

const S = (...t: string[]) => new Set(t)

test('identical sets are 1, disjoint sets are 0', () => {
  assert.equal(jaccard(S('a', 'b'), S('a', 'b')), 1)
  assert.equal(jaccard(S('a', 'b'), S('c', 'd')), 0)
})

test('an empty set scores 0 rather than dividing by zero', () => {
  assert.equal(jaccard(S(), S('a')), 0)
  assert.equal(jaccard(S('a'), S()), 0)
  assert.equal(jaccard(S(), S()), 0)
  assert.ok(Number.isFinite(jaccard(S(), S())))
})

test('⚠ THIS IS JACCARD AND NOT THE OVERLAP COEFFICIENT', () => {
  // §12: `shared / min` makes a short phrase a PERFECT SUBSET of every longer
  // phrase containing it — right for dedupe within one thread, wrong across
  // them. These two sets are where the metrics disagree: overlap says 1.0,
  // Jaccard says 2/5. If this ever reads 1, the denominator was "simplified".
  const short = S('bid', 'reminder')
  const long = S('bid', 'reminder', 'leads', 'page', 'badge')
  assert.equal(jaccard(short, long), 2 / 5)
  assert.notEqual(jaccard(short, long), 1)
})

test('similarity is symmetric', () => {
  const a = S('alpha', 'beta', 'gamma')
  const b = S('beta', 'gamma', 'delta', 'epsilon')
  assert.equal(jaccard(a, b), jaccard(b, a))
})

test('phraseTokens lowercases, splits on punctuation and drops single characters', () => {
  assert.deepEqual(
    [...phraseTokens("Add a BID-deadline reminder (to /leads), please!")],
    ['add', 'bid', 'deadline', 'reminder', 'to', 'leads', 'please']
  )
  // 'a' is gone as punctuation fallout, not as a stopword — the distinction
  // matters because this tokenizer deliberately has no stopword list.
  assert.ok(!phraseTokens('a b c word').has('a'))
  assert.ok(phraseTokens('a b c word').has('word'))
})

test('a set has no duplicates, so repetition cannot inflate a score', () => {
  assert.equal(phraseTokens('bid bid bid bid').size, 1)
  assert.equal(jaccard(phraseTokens('bid bid bid'), phraseTokens('bid')), 1)
})

/**
 * ⚠ THE DRIFT TEST, AND IT EXCLUDES ITSELF AND STRIPS COMMENTS.
 *
 * §12: a test that scans the source tree must strip comments and exclude
 * itself, or it measures its own documentation — this file's own docblocks
 * describe the metric it bans. The point of the scan is that `jaccard` reached
 * TWO copies before it reached one: the sweep phase wrote it, then
 * CommitmentsLedger.tsx wrote it again byte-identically because a client
 * component cannot import the sweep. Neither looked like a copy.
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

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('NOTHING OUTSIDE THIS MODULE DEFINES jaccard AGAIN', () => {
  const home = join('src', 'lib', 'utils', 'similarity.ts')
  const self = join('src', 'lib', 'utils', 'similarity.test.ts')

  const offenders = sourceFiles('src')
    .filter((f) => f !== home && f !== self)
    // A DEFINITION, not a call — `function jaccard` or `const jaccard =`.
    // Matching the bare word would flag every call site, which is the reuse
    // this module exists to encourage.
    .filter((f) => /(function|const|let)\s+jaccard\b/.test(stripComments(readFileSync(f, 'utf8'))))

  assert.deepEqual(
    offenders,
    [],
    `jaccard is defined outside its one home: ${offenders.join(', ')}`
  )
})
