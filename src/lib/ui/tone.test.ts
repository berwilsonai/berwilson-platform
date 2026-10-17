import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { contrastOklch } from './contrast'
import { readThemeTokens } from './tokens'
import { TONES, STATUS_TONES, CATEGORY_TONES, chipTone, inkTone, isTone } from './tone'

/**
 * Tokens come from the SAME reader `/settings/ui` uses (./tokens.ts), so the
 * thresholds asserted here and the ratios printed on that page cannot disagree.
 * Two parsers would mean the screen built to tell the truth about the palette
 * could be the one that was wrong.
 */
function token(name: string, block: ':root' | '.dark'): string {
  const theme = block === ':root' ? 'light' : 'dark'
  const value = readThemeTokens()[theme][name]
  assert.ok(value, `--${name} not found in ${block}`)
  return value
}

// ─── the vocabulary ──────────────────────────────────────────────────────────

test('every tone resolves, and an unknown one throws', () => {
  for (const t of TONES) {
    assert.ok(chipTone(t).length > 0, t)
    assert.ok(inkTone(t).length > 0, t)
  }
  // §12: reject an unknown tone. A silently colourless chip reads as a styling
  // slip rather than a missing case, so it never gets reported.
  // @ts-expect-error — deliberately outside the union
  assert.throws(() => chipTone('fuchsia'), /Unknown tone/)
  assert.ok(!isTone('fuchsia'))
  assert.ok(isTone('caution'))
})

test('the two kinds do not overlap', () => {
  const overlap = (STATUS_TONES as readonly string[]).filter((t) =>
    (CATEGORY_TONES as readonly string[]).includes(t)
  )
  assert.deepEqual(overlap, [])
  assert.equal(TONES.length, STATUS_TONES.length + CATEGORY_TONES.length)
})

test('a status tone carries no dark: variant, because the token does it', () => {
  // This is the whole point of routing status through CSS tokens: there is no
  // variant left to forget. `neutral` and `severe` ride existing tokens.
  for (const t of STATUS_TONES) {
    assert.ok(!chipTone(t).includes('dark:'), `${t} should not need a dark: variant: ${chipTone(t)}`)
    assert.ok(!inkTone(t).includes('dark:'), `${t} ink should not need a dark: variant`)
  }
})

test('a categorical tone always carries BOTH halves', () => {
  // These use the Tailwind palette, so a missing dark: variant here is exactly
  // the theme-blindness the status tokens exist to prevent.
  for (const t of CATEGORY_TONES) {
    const cls = chipTone(t)
    for (const prop of ['bg-', 'text-', 'ring-']) {
      assert.ok(cls.includes(prop), `${t} missing ${prop}`)
      assert.ok(cls.includes(`dark:${prop}`), `${t} missing dark:${prop} — would not respond to the theme`)
    }
  }
})

test('no tone uses the slate ramp, which is theme-blind', () => {
  // 34 of the 192 measured triples were slate. `neutral` replaces them with
  // bg-muted/text-muted-foreground/ring-border, which follows the theme.
  for (const t of TONES) {
    assert.ok(!chipTone(t).includes('slate-'), `${t} still uses slate: ${chipTone(t)}`)
    assert.ok(!inkTone(t).includes('slate-'), `${t} ink still uses slate`)
  }
  assert.equal(chipTone('neutral'), 'bg-muted text-muted-foreground ring-border')
})

test('a class string is never built by interpolation', () => {
  // A Tailwind class assembled at runtime is a class Tailwind never generated.
  const src = readFileSync('src/lib/ui/tone.ts', 'utf8')
  const palette = src.slice(src.indexOf('const CHIP'), src.indexOf('export function isTone'))
  assert.ok(!palette.includes('${'), 'a template placeholder inside the palette means a generated class')
})

// ─── the palette, measured ───────────────────────────────────────────────────

const PAIRS = ['positive', 'caution', 'critical', 'info'] as const

test('every status ink clears 4.5:1 on the card AND on its own surface, light', () => {
  const card = token('card', ':root')
  for (const name of PAIRS) {
    const ink = token(name, ':root')
    const surface = token(`${name}-surface`, ':root')
    const onCard = contrastOklch(ink, card)
    const onSurface = contrastOklch(ink, surface)
    assert.ok(onCard >= 4.5, `light ${name} ink on card is ${onCard.toFixed(2)}:1`)
    assert.ok(onSurface >= 4.5, `light ${name} ink on its own surface is ${onSurface.toFixed(2)}:1`)
  }
})

test('every status ink clears 4.5:1 on the card AND on its own surface, dark', () => {
  const card = token('card', '.dark')
  for (const name of PAIRS) {
    const ink = token(name, '.dark')
    const surface = token(`${name}-surface`, '.dark')
    const onCard = contrastOklch(ink, card)
    const onSurface = contrastOklch(ink, surface)
    assert.ok(onCard >= 4.5, `dark ${name} ink on card is ${onCard.toFixed(2)}:1`)
    assert.ok(onSurface >= 4.5, `dark ${name} ink on its own surface is ${onSurface.toFixed(2)}:1`)
  }
})

test('light and dark are genuinely different values', () => {
  // ⚠ THE --chart-* MISTAKE. Those five are byte-identical in :root and .dark,
  // which is only invisible because nothing renders them. Never again.
  for (const name of PAIRS) {
    for (const slot of ['', '-surface', '-edge']) {
      const l = token(`${name}${slot}`, ':root')
      const d = token(`${name}${slot}`, '.dark')
      assert.notEqual(l, d, `--${name}${slot} is identical in both themes`)
    }
  }
})

test('the edge is perceptible against the card, since it carries the block on the canvas', () => {
  // Measured 2026-10-17: in LIGHT mode a tinted surface sits at 1.02–1.06:1
  // against the canvas (0.976 vs 0.964–0.968), so off a card the ring is the
  // only thing giving the block an edge. It must stay visible.
  for (const name of PAIRS) {
    const light = contrastOklch(token(`${name}-edge`, ':root'), token('card', ':root'))
    const dark = contrastOklch(token(`${name}-edge`, '.dark'), token('card', '.dark'))
    assert.ok(light >= 1.25, `light ${name} edge on card is only ${light.toFixed(2)}:1`)
    assert.ok(dark >= 1.25, `dark ${name} edge on card is only ${dark.toFixed(2)}:1`)
  }
})

test('severe reads as text on its solid fill, in both themes', () => {
  const light = contrastOklch(token('primary-foreground', ':root'), token('critical', ':root'))
  const dark = contrastOklch(token('primary-foreground', '.dark'), token('critical', '.dark'))
  assert.ok(light >= 4.5, `light severe is ${light.toFixed(2)}:1`)
  assert.ok(dark >= 4.5, `dark severe is ${dark.toFixed(2)}:1`)
})

test('critical and destructive are not the same colour', () => {
  // A status and a destructive action are different questions; aliasing them is
  // how a Save button turns red.
  assert.notEqual(token('critical', ':root'), token('destructive', ':root'))
  assert.notEqual(token('critical', '.dark'), token('destructive', '.dark'))
})

test('every status token named in the palette exists in both blocks of globals.css', () => {
  // Catches the real failure mode: a tone added to tone.ts and to :root but not
  // to .dark renders with no colour in exactly one theme.
  const used = new Set<string>()
  for (const t of TONES) {
    for (const cls of `${chipTone(t)} ${inkTone(t)}`.split(/\s+/)) {
      const m = /^(?:bg|text|ring)-(positive|caution|critical|info)(-surface|-edge)?$/.exec(cls)
      if (m) used.add(`${m[1]}${m[2] ?? ''}`)
    }
  }
  assert.ok(used.size > 0, 'expected the status tones to reference tokens')
  for (const name of used) {
    assert.doesNotThrow(() => token(name, ':root'), `--${name} missing from :root`)
    assert.doesNotThrow(() => token(name, '.dark'), `--${name} missing from .dark`)
  }
})
