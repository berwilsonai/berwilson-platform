/**
 * One card radius, everywhere.
 *
 * `Panel` used `rounded-xl` while 145 hand-rolled shells used `rounded-lg`, so
 * two card radii appeared on the same screen. Under the chosen direction
 * `--radius` is 0.25rem, which makes `rounded-lg` exactly 4px — the radius that
 * direction actually specifies — and `rounded-xl` 5.6px. So the base is right
 * and the outliers are the xl ones.
 *
 * Pure string replacement over a fixed class sequence. No AST, no JSX
 * rewriting: §12 records that a regex rewriting JSX elements is how a build
 * breaks at 2am, and converging the CLASS fixes what a reader can see while
 * leaving the <Panel> adoption to attrition.
 *
 * Run: node scripts/codemod/card-radius.mjs [--write]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const WRITE = process.argv.includes('--write')
const FROM = 'rounded-xl border border-border bg-card'
const TO = 'rounded-lg border border-border bg-card'

function files(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) out.push(...files(full))
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

const touched = []
let total = 0
for (const file of files('src')) {
  // ui/card.tsx is Panel itself and is changed by hand, with a comment.
  if (file.endsWith(`ui${'/'}card.tsx`)) continue
  const before = readFileSync(file, 'utf8')
  if (!before.includes(FROM)) continue
  const hits = before.split(FROM).length - 1
  total += hits
  touched.push({ file, hits })
  if (WRITE) writeFileSync(file, before.split(FROM).join(TO))
}

console.log(`\n  ${total} shells in ${touched.length} files${WRITE ? ' (written)' : ' (dry run)'}`)
for (const t of touched) console.log(`    ${String(t.hits).padStart(3)}  ${t.file}`)
if (WRITE) {
  const m = `${process.env.TMPDIR ?? '/tmp'}/card-radius-manifest.txt`
  writeFileSync(m, touched.map((t) => t.file).join('\n') + '\n')
  console.log(`\n  manifest: ${m}`)
}
