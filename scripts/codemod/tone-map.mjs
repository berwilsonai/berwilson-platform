/**
 * Point the *_BADGE maps at the tone palette instead of spelling out classes.
 *
 * ⚠ IT REWRITES THE VALUES, NOT THE TYPE. Each map keeps `Record<K, string>`
 * and keeps returning a class string — it just gets that string from
 * `chipTone()` now. That is deliberate and it is what makes this safe: 49 of
 * the 71 consumer sites hand-roll their own chip
 * (`cn('inline-flex … ring-1 ring-inset', MAP[x])`), so turning the values into
 * tone NAMES would require editing every one of them, with a visual shift at
 * each. This way nothing downstream changes at all.
 *
 * What it buys: 39 distinct spellings fold to 13 tones, the palette has ONE
 * home, and the 34 `slate-*` values — which do not respond to the theme at all,
 * so a light chip stayed light on a dark card — become the OKLCH neutrals.
 *
 * The hue→tone table is DERIVED from the corpus (§12: generate the enumeration
 * from the same rows the column references), measured 2026-10-17:
 *   slate 34 · emerald 26 · amber 26 · blue 17 · violet 16 · red 16 ·
 *   indigo 13 · cyan 10 · sky 10 · teal 8 · rose 8 · orange 6
 * The first five carry meaning; the rest only ever mean "a different kind".
 *
 * Writes a manifest so the commit can stage from it (two sessions share this
 * repo and `git add -A` would absorb the other one's work).
 *
 * Run: node scripts/codemod/tone-map.mjs [--write]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const WRITE = process.argv.includes('--write')

const TONE_FOR_HUE = {
  slate: 'neutral',
  gray: 'neutral',
  zinc: 'neutral',
  neutral: 'neutral',
  emerald: 'positive',
  green: 'positive',
  amber: 'caution',
  yellow: 'caution',
  blue: 'info',
  red: 'critical',
  violet: 'violet',
  purple: 'violet',
  indigo: 'indigo',
  cyan: 'cyan',
  sky: 'sky',
  teal: 'teal',
  rose: 'rose',
  pink: 'rose',
  orange: 'orange',
}

function files(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) out.push(...files(full))
    else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) out.push(full)
  }
  return out
}

// A quoted string holding both a bg- and a text- palette class.
const TRIPLE = /'((?:[^'\n]*\bbg-([a-z]+)-\d+[^'\n]*\btext-[a-z]+-\d+[^'\n]*))'/g

const touched = []
let replaced = 0
const unknown = new Set()

for (const file of files('src/lib')) {
  // tone.ts IS the palette, declared literally in source — §12's required shape.
  if (file.endsWith(`ui${'/'}tone.ts`)) continue
  /*
   * ⚠ avatar.ts IS EXCLUDED, AND NOT FOR TIDINESS. Its eight values are a
   * HASH ramp: a contact's initials get a colour by name hash, purely so two
   * people look different. Three of those hues (emerald, amber, red-family)
   * map to STATUS tones, so folding them in would render a contact's avatar as
   * `positive` or `caution` — a person's face reading as an alert. Decoration
   * and status are different questions and this palette keeps them apart.
   * The avatar classes also already carry both themes, so there is nothing
   * theme-blind there to fix.
   */
  if (file.endsWith(`utils${'/'}avatar.ts`)) continue
  const before = readFileSync(file, 'utf8')
  let hits = 0

  let after = before.replace(TRIPLE, (whole, body, hue) => {
    const tone = TONE_FOR_HUE[hue]
    if (!tone) {
      unknown.add(hue)
      return whole
    }
    hits++
    // ⚠ `ring-1` inside a map value is NOT noise: TIER_CHIP's consumer does not
    // add it, so dropping it would silently remove that chip's ring. chipTone()
    // omits it because <Chip> supplies it.
    const keepsRing1 = /\bring-1\b/.test(body)
    return keepsRing1 ? `'ring-1 ' + chipTone('${tone}')` : `chipTone('${tone}')`
  })

  if (hits === 0) continue

  if (!/from '@\/lib\/ui\/tone'/.test(after)) {
    /*
     * ⚠ INSERT AFTER THE LAST LINE THAT *CLOSES* AN IMPORT, NOT AFTER THE LAST
     * LINE THAT STARTS ONE. The first version matched `startsWith('import')`
     * and dropped the statement INSIDE constants.ts's multi-line
     * `import type { … } from …` block, producing 40 syntax errors. The end of
     * an import is the line carrying its `from '…'`.
     */
    const lines = after.split('\n')
    let i = -1
    for (let n = 0; n < lines.length; n++) {
      if (/\bfrom\s+'[^']+'\s*;?\s*$/.test(lines[n])) i = n
      // Stop at the first real statement so a `from` inside a string later in
      // the file cannot drag the import into the middle of the module.
      if (i !== -1 && /^(?:export|const|function|type|interface)\b/.test(lines[n])) break
    }
    const stmt = "import { chipTone } from '@/lib/ui/tone'"
    if (i === -1) lines.unshift(stmt, '')
    else lines.splice(i + 1, 0, stmt)
    after = lines.join('\n')
  }

  touched.push({ file, hits })
  replaced += hits
  if (WRITE) writeFileSync(file, after)
}

console.log(`\n  ${replaced} values in ${touched.length} files${WRITE ? ' (written)' : ' (dry run)'}`)
for (const t of touched) console.log(`    ${String(t.hits).padStart(3)}  ${t.file}`)
if (unknown.size) console.log(`\n  ⚠ hues with no tone, left alone: ${[...unknown].join(', ')}`)

const manifest = `${process.env.TMPDIR ?? '/tmp'}/tone-map-manifest.txt`
if (WRITE) {
  writeFileSync(manifest, touched.map((t) => t.file).join('\n') + '\n')
  console.log(`\n  manifest: ${manifest}`)
}
