#!/usr/bin/env node
// One-shot, idempotent transform: add a `dark:` variant beside each light tint
// utility (bg/text/border-{color}-{shade}) so the app renders correctly in dark mode.
// Re-running is safe — a token that already has its dark counterpart is skipped.
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const COLORS = [
  'blue', 'green', 'amber', 'red', 'yellow', 'gray', 'slate', 'indigo',
  'emerald', 'orange', 'purple', 'rose', 'sky', 'teal', 'violet', 'pink',
  'cyan', 'lime', 'zinc', 'neutral', 'stone', 'fuchsia',
].join('|')

// prop -> { lightShade: darkSpec }
const MAPS = {
  bg: { '50': '950/40', '100': '900/40', '200': '900/60' },
  text: { '500': '400', '600': '400', '700': '300', '800': '300', '900': '200' },
  border: { '100': '900/50', '200': '800/60', '300': '700/60' },
  divide: { '100': '800/60', '200': '700/60' },
  ring: { '100': '900/50', '200': '800/60' },
}

let totalAdds = 0
const touched = []

for (const prop of Object.keys(MAPS)) {
  const shades = Object.keys(MAPS[prop]).join('|')
  // Capture optional variant prefixes (hover:, focus:, group-hover:, md:, etc.),
  // the color + shade, and an optional /opacity. Skip if a dark variant of the
  // same prefix+prop+color already exists later in the same class segment.
  const re = new RegExp(
    `\\b((?:[a-z][a-z0-9-]*:)*)(${prop})-(${COLORS})-(${shades})(\\/\\d+)?\\b` +
      `(?![^"'\`\\n]*\\bdark:(?:[a-z][a-z0-9-]*:)*${prop}-\\3-)`,
    'g'
  )

  const files = execSync(
    `grep -rlE "(${prop})-(${COLORS})-(${shades})" src --include="*.tsx"`,
    { cwd: process.cwd(), encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .filter(Boolean)

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    let adds = 0
    const out = src.replace(re, (m, prefix, p, color, shade) => {
      if (prefix.includes('dark:')) return m // never re-prefix an existing dark token
      adds++
      return `${m} dark:${prefix}${p}-${color}-${MAPS[p][shade]}`
    })
    if (adds > 0) {
      writeFileSync(file, out)
      totalAdds += adds
      if (!touched.includes(file)) touched.push(file)
    }
  }
}

console.log(`Added ${totalAdds} dark: variants across ${touched.length} files.`)
