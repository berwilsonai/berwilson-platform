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

  // ⚠ THE RAIL IS A FOURTH SURFACE AS OF 2026-10-27, AND NOTHING MEASURED IT.
  // While the sidebar was a dark slab, `--primary` only ever had to read on a
  // card; the light rail made the ACTIVE NAV ROW primary-coloured text on
  // `--sidebar`, a pairing no assertion here covered. This is why L 0.52 was
  // reverted rather than the 6.0 bar above being dropped to fit it (§12: when
  // a reason moves, the assertion gets STRONGER, it does not get deleted).
  const primaryOnRail = contrastOklch(t.light['primary'], t.light['sidebar'])
  assert.ok(primaryOnRail >= 4.5, `--primary on the rail is ${primaryOnRail.toFixed(2)}:1`)
  const mutedOnRail = contrastOklch(t.light['muted-foreground'], t.light['sidebar'])
  assert.ok(mutedOnRail >= 4.5, `--muted-foreground on the rail is ${mutedOnRail.toFixed(2)}:1`)
  const railInk = contrastOklch(t.light['sidebar-foreground'], t.light['sidebar'])
  assert.ok(railInk >= 7, `rail body ink is only ${railInk.toFixed(2)}:1`)

  // And the body text, which is most of what anyone actually reads.
  for (const theme of ['light', 'dark'] as const) {
    const body = contrastOklch(t[theme]['foreground'], t[theme]['card'])
    assert.ok(body >= 12, `${theme} body text on card is only ${body.toFixed(2)}:1`)
  }
})

/**
 * ⚠ THIS ASSERTION WAS `parsed.c === 0` UNTIL 2026-10-26, AND THE REWRITE IS
 * DELIBERATE RATHER THAN A RELAXATION.
 *
 * The old rule — "neutrals at zero chroma, and exactly one chromatic role" —
 * was protecting a real property: *a slightly blue grey is invisible in
 * isolation and obvious in aggregate*. That is a rule against ACCIDENT, and
 * exact-zero is the cheapest way to state it, not the truest one.
 *
 * Richard asked for the Jobber register, and Jobber's canvas is a warm taupe
 * (`hsl(43, 18%, 92%)` in their published Atlantis tokens) — warmth is a large
 * part of why that product reads friendly rather than clinical. So the neutrals
 * now carry a deliberate warm cast, and exact-zero would forbid the decision
 * while still not catching the bug it was written for: two greys at chroma 0.01
 * on DIFFERENT hues would pass an "is it small" test and look broken together.
 *
 * So the rewrite asserts what was actually meant, and is strictly stronger
 * against the original failure: every tinted neutral must sit on ONE hue, and
 * the tint must stay under a bound. A stray blue-grey beside a warm grey now
 * fails on the hue, where before it had to be exactly zero to pass at all.
 *
 * §12: a workaround's recorded reason must be re-tested before it is inherited.
 * This one was re-tested, and the reason survived in a better form.
 */
test('the neutrals share one hue and stay barely tinted', () => {
  const t = readThemeTokens()
  const NEUTRAL = ['background', 'foreground', 'card', 'muted', 'muted-foreground', 'secondary', 'accent']
  /*
    Above this a neutral stops being a neutral and starts being a colour.
    ⚠ RAISED 0.015 → 0.032 LATER THE SAME DAY, and the reason is not "the test
    was in the way". The bound tracks the palette it measures, and the palette
    was re-derived from the Ber Wilson logo itself: the mark's own cream field
    is `#ede6d3` = `oklch(0.925 0.026 90)`, so 0.015 would have forbidden the
    brand's actual colour. The PRINCIPLE is untouched — one hue, bounded, no
    accidental tints — and the hue check below is what does the real work.
  */
  const MAX_CHROMA = 0.032
  // Hues are only comparable where there is enough chroma to HAVE a hue; below
  // this the value is grey and its hue channel is noise.
  const HUE_FLOOR = 0.002

  for (const theme of ['light', 'dark'] as const) {
    const hues: { name: string; h: number }[] = []
    for (const name of NEUTRAL) {
      const parsed = parseOklch(t[theme][name])
      assert.ok(parsed, `${theme}/${name} is not an oklch() value`)
      assert.ok(
        parsed.c <= MAX_CHROMA,
        `${theme} --${name} has chroma ${parsed.c}; a neutral stays under ${MAX_CHROMA}`
      )
      if (parsed.c >= HUE_FLOOR) hues.push({ name, h: parsed.h })
    }
    // The real guard: one family, not seven.
    if (hues.length > 1) {
      const first = hues[0]
      for (const other of hues.slice(1)) {
        assert.ok(
          Math.abs(other.h - first.h) <= 1,
          `${theme} --${other.name} is hue ${other.h} but --${first.name} is hue ${first.h}; ` +
            `the neutrals must share one hue or they read as a mismatched set`
        )
      }
    }
  }
})

test('the ordinal ramp is monotone, stepped, and clear of every reserved hue', () => {
  /*
    ⚠ READ FROM globals.css, like everything else here, and asserting the
    ramp's STRUCTURE rather than its values — the four properties that make it
    an ordinal ramp at all, each of which has already been got wrong once.

      monotone lightness   — the thing the ramp encodes. Without it the
                             colour says nothing about where a stage sits.
      a visible step       — ΔL ≥ 0.06 between neighbours. At 0.045 the
                             validator rejected it and the bars read as one
                             colour; the gap is what the reader actually sees.
      the light end clears — ≥ 2:1 on the `--muted` track it is drawn on, or
      the track              stage one is a bar you cannot see.
      off the reserved hues — the first draft sat at hue 150 against
                             `--positive` at 152, so a pipeline stage would
                             have read as "good". A status colour is reserved
                             and never doubles as a series.

    ⚠ AND BOTH ARMS, NOT JUST LIGHT. The dark arm deliberately runs the other
    way, so a test that assumed one direction would have certified a ramp that
    is invisible in the theme it was not written in — which is this repo's own
    recorded failure from 10-27, six screenshots taken in the wrong theme.
  */
  const t = readThemeTokens()
  const RESERVED = ['positive', 'caution', 'critical', 'info', 'primary'] as const

  // THROWS rather than asserts, and for a type reason worth stating: `assert.ok`
  // does not narrow `string | null` out of a callback, so a soft check here
  // would leave every measurement below reading a possibly-absent token. A
  // missing step is the ramp silently losing a rung — there is no graceful
  // version of that.
  const token = (mode: 'light' | 'dark', name: string): string => {
    const v = t[mode][name]
    if (!v) throw new Error(`--${name} is not declared in the ${mode} block of globals.css`)
    return v
  }

  // `parseOklch` returns null for anything it cannot read, so the same rule
  // applies: a token that is no longer an oklch() literal must stop the test,
  // not quietly measure zero.
  const lch = (value: string) => {
    const p = parseOklch(value)
    if (!p) throw new Error(`not an oklch() value: ${value}`)
    return p
  }

  for (const mode of ['light', 'dark'] as const) {
    const steps = Array.from({ length: 7 }, (_, i) => token(mode, `ordinal-${i + 1}`))

    const L = steps.map((s) => lch(s).l)
    // Light runs light→dark; dark runs dark→light. Either is fine; wandering
    // is not, because then the colour no longer orders anything.
    const rising = L[1] > L[0]
    for (let i = 1; i < L.length; i++) {
      const gap = rising ? L[i] - L[i - 1] : L[i - 1] - L[i]
      assert.ok(gap >= 0.059, `${mode} ordinal ${i}→${i + 1}: ΔL ${gap.toFixed(3)}, under the 0.06 floor`)
    }

    // The end nearest the track is the one that can disappear into it.
    const nearest = rising ? steps[0] : steps[steps.length - 1]
    const onTrack = contrastOklch(nearest, token(mode, 'muted'))
    assert.ok(onTrack >= 2.0, `${mode} ordinal end is ${onTrack.toFixed(2)}:1 on --muted, under 2:1`)

    const hue = lch(steps[0]).h
    for (const name of RESERVED) {
      const other = lch(token(mode, name)).h
      const d = Math.min(Math.abs(hue - other), 360 - Math.abs(hue - other))
      assert.ok(d >= 25, `${mode} ordinal hue ${hue}° is ${d.toFixed(0)}° from --${name} — too close to a reserved meaning`)
    }
  }
})
