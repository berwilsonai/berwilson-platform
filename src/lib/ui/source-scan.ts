/**
 * Read the source tree and count things, with comments removed first.
 *
 * ⚠ WITHOUT STRIPPING COMMENTS EVERY COUNT IS WRONG, AND WRONG IN THE
 * DIRECTION THAT HIDES PROGRESS. Measured 2026-10-17: a naive grep for
 * `focus:` returns 2 hits, and BOTH are docblocks explaining why `focus:` must
 * never be used — the rule's own documentation reads as a violation of it. Same
 * for `window.confirm`, whose only occurrence in the repo is the line in
 * `confirm-dialog.tsx` saying it replaced it. A ratchet built on those numbers
 * can never reach zero, so it would be permanently ignored.
 *
 * Used by `conventions.test.ts`, which asserts each count is at or below a
 * recorded baseline. Not a lint rule: ESLint cannot see a Tailwind class string
 * or "this div is secretly a Panel", and the repo's lint baseline is a
 * deliberately frozen 23 problems (§9) that this must not disturb.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ⚠ TEST FILES ARE EXCLUDED, AND NOT FOR TIDINESS. `conventions.test.ts`
 * contains every banned pattern as a regex literal, so a scan that includes it
 * COUNTS ITSELF: the first run reported the card-shell and `text-[11px]`
 * ratchets as regressions and found a generated-class violation, all three of
 * them its own source. Tests render no UI, so excluding them costs no coverage
 * — and the alternative, hand-exempting each scanner, breaks the moment a
 * fourth pattern is added.
 */
const EXCLUDED = /\.test\.tsx?$|src\/lib\/ui\/source-scan\.ts$/

export function sourceFiles(root = 'src', exts = ['.ts', '.tsx']): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (exts.some((e) => full.endsWith(e)) && !EXCLUDED.test(full)) out.push(full)
    }
  }
  walk(root)
  return out.sort()
}

/**
 * Remove block and line comments. Deliberately simple: it does not parse, so a
 * `//` inside a string literal is also removed. That is the safe direction for
 * a ratchet — it can only ever UNDERCOUNT a violation hidden in a URL, never
 * invent one, and no counted pattern here looks like a URL.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

export interface Occurrence {
  file: string
  line: number
  text: string
}

/** Every match of `pattern` in the tree, with comments already removed. */
export function scan(pattern: RegExp, files = sourceFiles()): Occurrence[] {
  const hits: Occurrence[] = []
  for (const file of files) {
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
    lines.forEach((text, i) => {
      const re = new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        hits.push({ file, line: i + 1, text: m[0] })
        if (m.index === re.lastIndex) re.lastIndex++
      }
    })
  }
  return hits
}

export function count(pattern: RegExp, files?: string[]): number {
  return scan(pattern, files).length
}

export interface ClassString {
  file: string
  line: number
  /** The quoted run, quotes included. */
  text: string
}

/**
 * Every quoted run in the tree that could be a Tailwind class string.
 *
 * A class string never spans a quote, so a quoted run is the right unit: two
 * classes in the SAME run are on the same element and can fight each other,
 * which is what the fill/ink and opacity-modifier assertions need to see.
 * Comments are stripped first, for the reason at the top of this file.
 */
export function classStrings(files = sourceFiles()): ClassString[] {
  const out: ClassString[] = []
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'))
    for (const m of src.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g)) {
      if (!/-/.test(m[0])) continue
      out.push({ file, line: src.slice(0, m.index).split('\n').length, text: m[0] })
    }
  }
  return out
}

/**
 * Strip Tailwind variant prefixes from one class token: `sm:hover:bg-primary`
 * → `bg-primary`. Arbitrary variants (`data-[open]:`, `[&_svg]:`) carry their
 * own colons inside brackets, so the split has to respect bracket depth.
 */
export function baseUtility(token: string): string {
  let depth = 0
  let last = 0
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth--
    else if (c === ':' && depth === 0) last = i + 1
  }
  return token.slice(last).replace(/^!/, '')
}
