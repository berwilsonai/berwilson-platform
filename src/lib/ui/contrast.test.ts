import { test } from 'node:test'
import assert from 'node:assert/strict'

import { oklchToRgb, contrast, contrastOklch, parseOklch } from './contrast'

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
  // globals.css says --primary is "Dark enough for white text (~6.5:1)" and
  // --muted-foreground is "comfortably legible at small sizes (~6:1 on white)".
  // If a future palette edit breaks either, the comment becomes a lie — which
  // is worse than no comment.
  const primaryOnWhite = contrastOklch('oklch(0.40 0.105 262)', 'oklch(1 0 0)')
  assert.ok(primaryOnWhite >= 6.0, `--primary on white is ${primaryOnWhite.toFixed(2)}:1`)

  const mutedOnWhite = contrastOklch('oklch(0.46 0.015 260)', 'oklch(1 0 0)')
  assert.ok(mutedOnWhite >= 5.5, `--muted-foreground on white is ${mutedOnWhite.toFixed(2)}:1`)

  // And the dark theme's counterparts, against the dark card rather than black.
  const darkCard = 'oklch(0.205 0.01 260)'
  const primaryDark = contrastOklch('oklch(0.72 0.10 262)', darkCard)
  assert.ok(primaryDark >= 6.0, `dark --primary on card is ${primaryDark.toFixed(2)}:1`)
  const mutedDark = contrastOklch('oklch(0.75 0.01 260)', darkCard)
  assert.ok(mutedDark >= 5.5, `dark --muted-foreground on card is ${mutedDark.toFixed(2)}:1`)
})
