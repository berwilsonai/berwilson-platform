import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { contrastOklch, lightnessDelta } from './contrast'
import { measureTones, MEASURED_TONES, readThemeTokens } from './tokens'
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

test('measureTones gives /settings/ui a complete table, with no gaps to render', () => {
  // The style guide prints these numbers. A null becomes an em dash and a
  // missing token becomes a blank cell, so the page would quietly under-report
  // the palette it exists to audit — the one failure it must not have.
  const rows = measureTones()
  assert.equal(rows.length, MEASURED_TONES.length * 2, 'expected every tone in both themes')
  for (const r of rows) {
    for (const [slot, v] of Object.entries(r)) {
      if (slot === 'tone' || slot === 'theme') continue
      assert.equal(typeof v, 'number', `${r.theme}/${r.tone}: ${slot} did not measure`)
      assert.ok(Number.isFinite(v as number), `${r.theme}/${r.tone}: ${slot} is not finite`)
    }
  }
})

test('every surface is perceptibly separated from the one behind it', () => {
  // ⚠ MEASURED AS A LIGHTNESS DELTA, NOT A CONTRAST RATIO. WCAG contrast has a
  // +0.05 floor that swamps real differences at near-black — the dark sidebar
  // read 1.03:1 against the canvas at L 0.155 and still read 1.031:1 at
  // L 0.085, so the metric could not see a change that is obvious to look at.
  // OKLCH lightness is perceptually uniform, so one threshold works at both
  // ends of the range. This palette has no shadows on resting surfaces, which
  // makes these steps the only thing distinguishing one plane from another.
  const MIN = 0.03
  for (const theme of ['light', 'dark'] as const) {
    const t = readThemeTokens()[theme]
    const pairs: [string, string][] = [
      ['card', 'background'],
      ['sidebar', 'background'],
      ['sidebar-accent', 'sidebar'],
      ['muted', 'card'],
    ]
    for (const [a, b] of pairs) {
      // `--border` and friends carry alpha in dark mode and are not comparable.
      if (t[a].includes('%') || t[b].includes('%')) continue
      const d = lightnessDelta(t[a], t[b])
      assert.ok(d >= MIN, `${theme}: --${a} is only ΔL ${d.toFixed(3)} from --${b} (need ${MIN})`)
    }
  }
})

/**
 * ⚠ THIS ASSERTED `--elev-1` AND `--elev-2` WERE LITERALLY `0 0 0 0 transparent`
 * UNTIL 2026-10-26. The rewrite is deliberate and is tied to the density change.
 *
 * The shadows were removed on 10-17 for a MEASURED reason, not a taste one: at
 * `--spacing: 0.22rem`, a shadow on every card turned a list of 181 documents
 * into mush. That reason was re-tested rather than inherited (§12) — and it has
 * gone away, because the thing it depended on moved. Jobber does not avoid
 * elevation; it affords elevation by not being that dense. The density went
 * back to Tailwind's default first, and the resting shadow follows from it.
 *
 * So the rule the file is actually trying to protect is not "no shadow" — it is
 * "a resting card must not SHOUT, and the ladder must mean something". That is
 * what is asserted now: elev-1 is quieter than elev-2 is quieter than elev-3,
 * every slot is declared in both themes, and elev-1's opacity stays under a
 * bound so nobody re-adds "just a little lift" and ends up at a drop shadow.
 */
test('the elevation ladder is ordered, and a resting surface stays quiet', () => {
  const css = readFileSync('src/app/globals.css', 'utf8')

  /**
   * How dark a shadow gets at its darkest layer.
   *
   * ⚠ THE FIRST VERSION SUMMED THE ALPHAS AND WAS WRONG — it reported the dark
   * `--elev-2` (two tight layers, 0.35 + 0.28) as heavier than `--elev-3` (one
   * wide-blur layer at 0.6), which is the opposite of what the eye sees,
   * because summing ignores blur and spread entirely. The test failing was
   * right; its reasoning was not. Max alpha is a fair proxy for "how much does
   * this shout" and needs no blur maths to be honest about ordering.
   */
  const weight = (v: string): number =>
    Math.max(0, ...[...v.matchAll(/\/\s*([\d.]+)\s*\)/g)].map((m) => Number(m[1])))

  const read = (slot: string) =>
    [...css.matchAll(new RegExp(`--${slot}:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim())

  for (const slot of ['elev-1', 'elev-2', 'elev-3']) {
    const hits = read(slot)
    assert.ok(hits.length >= 2, `expected --${slot} in both themes, found ${hits.length}`)
  }

  // Both themes declare all three in the same order, so index 0 is light and
  // index 1 is the dark override that wins by being last in the file.
  const [one, two, three] = [read('elev-1'), read('elev-2'), read('elev-3')]
  for (let i = 0; i < Math.min(one.length, two.length, three.length); i++) {
    const w1 = weight(one[i])
    const w2 = weight(two[i])
    const w3 = weight(three[i])
    assert.ok(w1 > 0, `--elev-1 "${one[i]}" has no shadow at all — the ladder starts at rest, not at nothing`)
    assert.ok(w1 < w2, `--elev-1 (${w1}) must be quieter than --elev-2 (${w2})`)
    assert.ok(w2 < w3, `--elev-2 (${w2}) must be quieter than --elev-3 (${w3})`)
    /*
      A resting card is on screen hundreds of times at once; past this it is
      noise rather than separation, which is exactly the 10-17 failure. The
      bound is per-theme because a dark canvas needs far more alpha to read as
      the same amount of shadow — index 0 is the `:root` occurrence and index 1
      the `.dark` override, by their order in the file.
    */
    const restingCap = i === 0 ? 0.08 : 0.35
    assert.ok(
      w1 <= restingCap,
      `--elev-1 (${w1}) is too heavy for a surface that appears on every card (cap ${restingCap})`
    )
  }
})
