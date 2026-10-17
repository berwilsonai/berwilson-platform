/**
 * Render the direction gallery and assert the comparison is honest.
 *
 * ⚠ THE POINT IS NOT "DOES IT RENDER". It is whether the preview is TOKEN-PURE.
 * A single `text-amber-700` in there would sit unchanged across all three
 * columns while everything around it moved, so the screen would show three
 * directions that differ less than they really do — a mock-up pretending to be
 * a measurement. Nothing else catches that: it builds, it typechecks, and it
 * looks plausible.
 *
 * Also asserts each direction's two halves carry the theme class and the
 * direction attribute on the SAME element. Written as a descendant selector
 * instead, the light rule would also match inside `.dark` and the dark column
 * would silently render the light palette.
 *
 * Run: npx tsx scripts/verify-directions.tsx
 *
 * ⚠ `.tsx` under tsx, not `.mts` under deploy/register.mjs — see
 * verify-mspa-render.tsx for the two failures that causes.
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import DirectionPreview from '../src/app/settings/ui/DirectionPreview'
import DirectionGallery from '../src/app/settings/ui/DirectionGallery'

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\nDirection preview — token purity\n')

const preview = renderToStaticMarkup(React.createElement(DirectionPreview))

// Any Tailwind palette colour is a colour a direction cannot change.
const PALETTES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow',
  'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
  'purple', 'fuchsia', 'pink', 'rose',
]
const offenders: string[] = []
for (const p of PALETTES) {
  const re = new RegExp(`\\b(?:bg|text|ring|border|from|to|via|fill|stroke)-${p}-\\d+`, 'g')
  for (const m of preview.matchAll(re)) offenders.push(m[0])
}
check('no hardcoded palette colour in the preview', offenders.length === 0, offenders.join(', '))
check('no literal hex colour', !/#[0-9a-fA-F]{3,8}\b/.test(preview))

// And it must actually USE the tokens, or purity is vacuous.
for (const cls of ['bg-card', 'text-muted-foreground', 'border-border', 'elev-1',
                   'bg-critical-surface', 'ring-critical-edge', 'text-caution',
                   'bg-positive', 'text-primary-foreground', 'label-caps', 'tnum']) {
  check(`uses ${cls}`, preview.includes(cls))
}

for (const bad of ['NaN', 'undefined', 'Infinity', '[object Object]']) {
  check(`no ${bad} in the preview`, !preview.includes(bad))
}

// §12: a bare em dash at a value's own weight reads as a failed render.
check('an unset value is named in words, not an em dash at full weight',
  preview.includes('Not set') && !/text-3xl[^>]*>\s*—\s*</.test(preview))

console.log('\nGallery — four directions, both themes\n')

const gallery = renderToStaticMarkup(React.createElement(DirectionGallery, {}))

check('all four directions rendered', ['Current', 'A — Institutional', 'B — Editorial', 'C — Engineered']
  .every((n) => gallery.includes(n)))

for (const id of ['a', 'b', 'c']) {
  const occurrences = (gallery.match(new RegExp(`data-direction="${id}"`, 'g')) ?? []).length
  check(`direction ${id} appears exactly twice (light + dark)`, occurrences === 2, `got ${occurrences}`)
  // The dark half must carry BOTH on one element, in either attribute order.
  const paired = new RegExp(`class="dark"[^>]*data-direction="${id}"|data-direction="${id}"[^>]*class="dark"`)
  check(`direction ${id}'s dark half pairs .dark with the attribute on one element`, paired.test(gallery))
}
// Current is the baseline and must carry no direction attribute at all.
check('the current look carries no data-direction', (gallery.match(/data-direction/g) ?? []).length === 6)

// Measured vitals must be numbers, not blanks.
const ratios = gallery.match(/\d+\.\d:1/g) ?? []
check('measured contrast ratios are printed', ratios.length >= 24, `found ${ratios.length}`)
for (const bad of ['NaN', 'undefined', 'Infinity']) {
  check(`no ${bad} in the gallery`, !gallery.includes(bad))
}

console.log(failures === 0 ? '\n✓ the comparison is honest\n' : `\n✗ ${failures} failed\n`)
process.exitCode = failures === 0 ? 0 : 1
