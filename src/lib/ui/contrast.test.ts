import { test } from 'node:test'
import assert from 'node:assert/strict'

import { oklchToRgb, contrast, contrastOklch, parseOklch } from './contrast'
import { readThemeTokens } from './tokens'

const hex = (l: number, c: number, h: number) => {
  const { r, g, b } = oklchToRgb(l, c, h)
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/**
 * The converter is verified against values whose answer is known independently,
 * because a colour-space conversion that is subtly wrong produces plausible
 * numbers and would silently certify an unreadable palette (§12: verify one row
 * against something you know, and when a check fails, suspect the check).
 */

test('the extremes land exactly where they must', () => {
  assert.equal(hex(1, 0, 0), '#ffffff')
  assert.equal(hex(0, 0, 0), '#000000')
  assert.equal(Number(contrastOklch('oklch(1 0 0)', 'oklch(0 0 0)').toFixed(2)), 21)
})

test('a mid grey is neutral in all three channels', () => {
  const g = hex(0.5, 0, 0)
  assert.equal(g.slice(1, 3), g.slice(3, 5))
  assert.equal(g.slice(3, 5), g.slice(5, 7))
})

test('contrast is symmetric and self-contrast is 1', () => {
  const a = oklchToRgb(0.4, 0.105, 262)
  const b = oklchToRgb(1, 0, 0)
  assert.equal(contrast(a, b).toFixed(4), contrast(b, a).toFixed(4))
  assert.equal(contrast(a, a).toFixed(2), '1.00')
})

test('out-of-gamut values clamp rather than wrap', () => {
  // A chroma no display can show must not fold round into a different colour.
  const { r, g, b } = oklchToRgb(0.6, 0.9, 0)
  for (const ch of [r, g, b]) {
    assert.ok(ch >= 0 && ch <= 1, `channel out of range: ${ch}`)
  }
})

test('parseOklch reads the forms globals.css actually uses', () => {
  assert.deepEqual(parseOklch('oklch(0.40 0.105 262)'), { l: 0.4, c: 0.105, h: 262 })
  assert.deepEqual(parseOklch('oklch(0.92 0.02 260 / 12%)'), { l: 0.92, c: 0.02, h: 260 })
  assert.equal(parseOklch('#ffffff'), null)
  assert.equal(parseOklch('var(--border)'), null)
})

test("the palette's own documented claims hold", () => {
  // ⚠ READ FROM globals.css, NEVER RETYPED. This test first hardcoded the
  // palette's oklch values, and the 10-17 redraw changed every one of them —
  // so it kept passing while measuring colours that no longer existed
  // anywhere. A test with a copied constant in it verifies the copy.
  const t = readThemeTokens()

  const primaryOnWhite = contrastOklch(t.light['primary'], t.light['card'])
  assert.ok(primaryOnWhite >= 6.0, `--primary on card is ${primaryOnWhite.toFixed(2)}:1`)
  const mutedOnWhite = contrastOklch(t.light['muted-foreground'], t.light['card'])
  assert.ok(mutedOnWhite >= 5.5, `--muted-foreground on card is ${mutedOnWhite.toFixed(2)}:1`)

  const primaryDark = contrastOklch(t.dark['primary'], t.dark['card'])
  assert.ok(primaryDark >= 6.0, `dark --primary on card is ${primaryDark.toFixed(2)}:1`)
  const mutedDark = contrastOklch(t.dark['muted-foreground'], t.dark['card'])
  assert.ok(mutedDark >= 5.5, `dark --muted-foreground on card is ${mutedDark.toFixed(2)}:1`)

  // The accent is the only chromatic role in this palette, so its label has to
  // read on the filled button as well as the accent reads on the card.
  const labelOnPrimary = contrastOklch(t.light['primary-foreground'], t.light['primary'])
  assert.ok(labelOnPrimary >= 4.5, `light button label is ${labelOnPrimary.toFixed(2)}:1`)
  const labelOnPrimaryDark = contrastOklch(t.dark['primary-foreground'], t.dark['primary'])
  assert.ok(labelOnPrimaryDark >= 4.5, `dark button label is ${labelOnPrimaryDark.toFixed(2)}:1`)

  // And the body text, which is most of what anyone actually reads.
  for (const theme of ['light', 'dark'] as const) {
    const body = contrastOklch(t[theme]['foreground'], t[theme]['card'])
    assert.ok(body >= 12, `${theme} body text on card is only ${body.toFixed(2)}:1`)
  }
})

test('the neutrals are neutral — zero chroma, by assertion', () => {
  // The palette's stated rule is "neutrals at zero chroma, and exactly one
  // chromatic role". That is only true if nobody tints a grey later, and a
  // slightly blue grey is invisible in isolation and obvious in aggregate.
  const t = readThemeTokens()
  const NEUTRAL = ['background', 'foreground', 'card', 'muted', 'muted-foreground', 'secondary', 'accent']
  for (const theme of ['light', 'dark'] as const) {
    for (const name of NEUTRAL) {
      const parsed = parseOklch(t[theme][name])
      assert.ok(parsed, `${theme}/${name} is not an oklch() value`)
      assert.ok(parsed.c === 0, `${theme} --${name} has chroma ${parsed.c}; the neutrals are zero-chroma`)
    }
  }
})
