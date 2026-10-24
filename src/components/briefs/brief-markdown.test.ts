/**
 * The pipe-table guard in `BriefMarkdown`.
 *
 * Both halves matter and the second is the one that bites: a table must render,
 * and PROSE CONTAINING A PIPE MUST NOT become one. The renderer is shared by
 * /intel and /jobs, so a false positive turns an agent's sentence into a
 * one-row table on a live answer.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

// The helpers are module-private (the component is the export), so they are
// exercised through the same source the component compiles from. Reading the
// real artifact rather than pasting a copy: a test that hardcodes the thing it
// verifies is testing the copy (§12).
const SRC = readFileSync('src/components/briefs/BriefMarkdown.tsx', 'utf8')

function extract(name: string): string {
  const start = SRC.indexOf(`function ${name}(`)
  assert.ok(start > 0, `${name} is gone from BriefMarkdown.tsx`)
  // Walk braces from the signature's opening brace to its match.
  const open = SRC.indexOf('{', start)
  let depth = 0
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1) }
  }
  throw new Error(`could not find the end of ${name}`)
}

// Strip the TypeScript annotations so the bodies run as plain JS.
const js = (src: string) =>
  src
    .replace(/: string \| undefined/g, '')
    .replace(/: string\[\]/g, '')
    .replace(/: string/g, '')
    .replace(/: boolean/g, '')
    .replace(/\(c\) =>/g, '(c) =>')

const isTableSeparator = new Function(`${js(extract('isTableSeparator'))}; return isTableSeparator`)() as
  (line: string | undefined) => boolean
const splitRow = new Function(`${js(extract('splitRow'))}; return splitRow`)() as
  (line: string) => string[]

test('a real separator line is recognised, in every alignment form', () => {
  for (const sep of ['|---|---|', '| --- | --- |', '|:---|---:|:--:|', '|-|-|', '| ------- |']) {
    assert.equal(isTableSeparator(sep), true, `${sep} should be a separator`)
  }
})

test('PROSE CONTAINING A PIPE IS NOT A SEPARATOR — the false positive that matters', () => {
  for (const line of [
    '| Name | Title | Company |',          // a header row is not a separator
    'Commercial | Operational | Financial', // prose with pipes, no leading pipe
    '| the deal is either A | or B |',
    '|  |  |',                              // pipes and spaces but no dashes
    '',
    undefined,
    '— a dash, but no pipes at all',
  ]) {
    assert.equal(isTableSeparator(line), false, `${JSON.stringify(line)} must not be a separator`)
  }
})

test('a row splits into trimmed cells with the delimiters dropped', () => {
  assert.deepEqual(splitRow('| Name | Title | Company |'), ['Name', 'Title', 'Company'])
  assert.deepEqual(splitRow('|Nisha Desai|Managing Director|Aurora|'), ['Nisha Desai', 'Managing Director', 'Aurora'])
  // A row with no trailing delimiter still parses — models emit both.
  assert.deepEqual(splitRow('| A | B'), ['A', 'B'])
})

test('an empty cell survives as an empty string, never as undefined', () => {
  const cells = splitRow('| A |  | C |')
  assert.equal(cells.length, 3)
  assert.equal(cells[1], '')
  for (const c of cells) assert.equal(typeof c, 'string')
})

test('the component renders a table at all — the branch is wired, not just written', () => {
  // §12: a static check that has never been shown to fire proves nothing. This
  // asserts the branch exists AND is guarded by the separator test, which is
  // what stops it eating prose.
  assert.match(SRC, /isTableSeparator\(lines\[i \+ 1\]\)/)
  assert.match(SRC, /<table/)
  assert.match(SRC, /<thead/)
})
