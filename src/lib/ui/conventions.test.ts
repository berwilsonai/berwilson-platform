import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { count, scan, sourceFiles, stripComments } from './source-scan'

/**
 * The house conventions, as assertions over the source tree.
 *
 * ⚠ EVERY NUMBER HERE IS A RATCHET, NOT A TARGET. Each asserts "no worse than
 * the baseline recorded on this date". Two sessions share this repo, so a test
 * that demanded perfection would block the other one's unrelated work; a test
 * that only forbids REGRESSION never does. When a count drops, lower the
 * baseline in the same commit — that is the progress record.
 *
 * ⚠ AND THE COUNTS STRIP COMMENTS FIRST (see source-scan.ts). A naive grep for
 * `focus:` finds 2 hits and both are docblocks explaining why it is banned, so
 * a ratchet on the raw number could never reach zero and would be ignored.
 *
 * This is not a lint rule because ESLint cannot see a Tailwind class string, or
 * that a particular `div` is secretly a `Panel`. The repo's lint baseline is a
 * deliberately frozen 23 problems (§9) and this must not disturb it.
 *
 * Several of these encode a §12 rule mechanically for the first time.
 */

const BASELINE_DATE = '2026-10-17'

// ─── invariants already held: these must stay at zero ────────────────────────

test('focus: is never used — it fires on a mouse click too', () => {
  // §12. Measured 0 real uses against 396 `focus-visible:`; the convention is
  // fully honoured and the only job here is keeping it that way.
  const hits = scan(/(?:^|[^-\w])focus:[a-z-]/)
  assert.deepEqual(
    hits.map((h) => `${h.file}:${h.line}`),
    [],
    'use focus-visible: — see button.tsx for the idiom'
  )
})

test('no window.alert or window.confirm', () => {
  // `ui/confirm-dialog.tsx` exists and 34 files use it.
  const hits = scan(/window\.(?:alert|confirm)\(/)
  assert.deepEqual(hits.map((h) => `${h.file}:${h.line}`), [])
})

test('no loading.tsx at a route group ROOT', () => {
  // §12: a `loading.tsx` at a route group's root 500s the whole route, and a
  // build that exits 0 having listed the route is not evidence it answers. In a
  // subsegment it is fine and necessary. This is the first mechanical check for
  // it — until now the rule was prose and had already cost the hours once.
  const groups: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (!statSync(full).isDirectory()) continue
      if (entry.startsWith('(') && entry.endsWith(')')) groups.push(full)
      walk(full)
    }
  }
  walk('src/app')
  assert.ok(groups.length > 0, 'expected at least one route group — has the layout changed?')
  for (const g of groups) {
    assert.ok(!existsSync(join(g, 'loading.tsx')), `${g}/loading.tsx will 500 the whole route`)
  }
})

test('a Tailwind class is never assembled from a variable', () => {
  // §12: a Tailwind class string stored in the database is never generated —
  // and the same is true of one built by interpolation at runtime.
  //
  // ⚠ THE LOOKBEHIND IS LOAD-BEARING. Written as `(?:bg|text|ring|border)-\$\{`
  // this matched `pepper-text-${Date.now()}` in notify/text.ts — a temp
  // FILENAME, not a class. That is §12's own trap ("a substring hint matches
  // any word that CONTAINS it", the one that put `title` inside
  // `Entitlements`), so the prefix must start a token rather than end one.
  const hits = scan(/(?<![\w-])(?:bg|text|ring|border)-\$\{/)
  assert.deepEqual(hits.map((h) => `${h.file}:${h.line}`), [])
})

test('ink is never the same lightness as the fill it sits on', () => {
  /*
    ⚠ THIS TEST EXISTS BECAUSE A CODEMOD SHIPPED THE BUG IT CATCHES.

    The 10-27 colour tokenisation mapped `bg-slate-900 text-white` — a DARK
    FILL in light mode, a print button, a numbered bullet — to `bg-muted
    text-white`, on the assumption that the 800–950 end of the neutral ramp
    only ever appeared as a `dark:` variant. It did not, and 13 controls
    rendered white-on-near-white: present in the DOM, invisible on screen,
    passing typecheck, build and every other test.

    Nothing could have caught it except looking, and looking does not scale to
    97 pages. What DOES scale is the structural rule underneath: the app has
    exactly two inks and two fills, and they pair one way round.
      `bg-foreground` takes `text-background`
      `bg-card` / `bg-background` / `bg-muted` take `text-foreground`
    Any class string pairing a light fill with a light ink, or a dark fill with
    a dark ink, is a rendering bug whatever it looks like in the source.

    `text-white` is included as a light ink deliberately: it is theme-blind, so
    on `bg-muted` it is wrong in BOTH themes rather than only one.
  */
  const LIGHT_FILL = /\bbg-(?:card|background|muted|secondary|accent|popover)(?:\/\d+)?(?![\w-])/
  const LIGHT_INK = /\btext-(?:background|white)(?:\/\d+)?(?![\w-])/
  const DARK_FILL = /\bbg-foreground(?:\/\d+)?(?![\w-])/
  const DARK_INK = /\btext-(?:foreground|muted-foreground|black)(?:\/\d+)?(?![\w-])/

  const bad: string[] = []
  for (const file of sourceFiles()) {
    const src = readFileSync(file, 'utf8')
    // Quoted runs only — a class string never spans a quote.
    for (const m of src.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g)) {
      const s = m[0]
      if (!s.includes('bg-')) continue
      // `bg-muted-foreground` is a dark fill despite starting `bg-muted`.
      const light = LIGHT_FILL.test(s) && !/\bbg-muted-foreground/.test(s)
      if ((light && LIGHT_INK.test(s)) || (DARK_FILL.test(s) && DARK_INK.test(s))) {
        const line = src.slice(0, m.index).split('\n').length
        bad.push(`${file}:${line}  ${s.slice(0, 90)}`)
      }
    }
  }
  assert.deepEqual(bad, [], 'a fill and an ink of the same lightness — the text is invisible')
})

// ─── ratchets: these must shrink, never grow ─────────────────────────────────

/** Assert a count is at or below its baseline, and say so usefully when not. */
function ratchet(label: string, actual: number, baseline: number, fix: string) {
  assert.ok(
    actual <= baseline,
    `${label}: ${actual}, up from the ${BASELINE_DATE} baseline of ${baseline}. ${fix}`
  )
}

test(`the card shell is converging on Panel (baseline ${BASELINE_DATE})`, () => {
  // `Panel` (ui/card.tsx) is the card and is used 107 times, but the shell is
  // still hand-written — and the dominant hand-rolled radius disagrees with
  // Panel's own `rounded-xl`, so two card radii appear on one screen.
  //
  // ⚠ /settings/ui IS EXEMPT, AND THIS RATCHET IS WHY THE EXEMPTION IS NAMED
  // RATHER THAN ABSORBED. It caught its own author within minutes: the style
  // guide's elevation swatches pushed the count 84 → 86. They cannot be
  // `Panel`s — Panel bakes in `elev-1`, so a swatch demonstrating `elev-2`
  // would be showing two elevations at once. The style guide is the one file
  // whose job is to render a primitive's raw ingredients. Raising the baseline
  // instead would have been the easy move and would have retired the ratchet.
  const files = sourceFiles().filter((f) => !f.endsWith('src/app/settings/ui/page.tsx'))
  // ⚠ ONE RADIUS IS NOW AN INVARIANT, NOT A RATCHET. `Panel` is `rounded-lg`
  // (= `--radius` exactly, 4px) and the 85 `rounded-xl` outliers were converged
  // on 10-17, so a card at xl is a NEW second radius on the same screen rather
  // than inherited debt — there is nothing to drain down to.
  const xl = scan(/rounded-xl border border-border bg-card/).filter(
    (h) => !h.file.endsWith('src/app/settings/ui/page.tsx')
  )
  assert.deepEqual(
    xl.map((h) => `${h.file}:${h.line}`),
    [],
    'a card is rounded-lg (= --radius). Use <Panel> from @/components/ui/card.'
  )
  /*
    The hand-rolled count itself is still attrition: swap the div for <Panel>
    when a file is open for another reason.

    ⚠ A BORDERED BUTTON IS NOT A CARD, AND THIS SCAN USED TO COUNT IT AS ONE.
    On 2026-10-27 the 274 hand-rolled buttons were converged on the shape
    `ui/button.tsx` already defines, which moved them `rounded-md` → the one
    radius `Panel` uses — and a secondary button is `rounded-lg border
    border-border bg-card`, byte-for-byte the pattern below. The count jumped
    231 → 236 with not one new card in the tree.

    Raising the baseline would have been the easy move and would have made the
    ratchet mean less than it did before. The scan is NARROWED instead: a class
    string carrying `inline-flex` and a height is a control, not a surface.
    That is strictly more accurate, so the baseline comes DOWN rather than up:
    measured against the tree BEFORE the button change and the tree after, the
    narrowed scan returns 227 both times — proving the convergence added no
    cards at all, and that the old 231 was four buttons miscounted as surfaces.
  */
  const cardShells = files.reduce((n, file) => {
    const src = stripComments(readFileSync(file, 'utf8'))
    for (const m of src.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g)) {
      const s = m[0]
      if (!/rounded-lg border border-border bg-card/.test(s)) continue
      if (/\binline-flex\b/.test(s) && /\bh-\d|\bh-\[/.test(s)) continue // a button
      n++
    }
    return n
  }, 0)
  ratchet('hand-rolled card shell', cardShells, 227,
    'Use <Panel> from @/components/ui/card.')
})

test(`elevation is .elev-*, not raw shadow-* (baseline ${BASELINE_DATE})`, () => {
  // §12 / §7. The remaining 15 include 5 legitimate SVG map markers.
  ratchet('raw shadow-* in components', count(/shadow-(?:sm|md|lg|xl|2xl|\[)/, sourceFiles('src/components')), 15,
    'Use .elev-1/.elev-2/.elev-3, declared in globals.css.')
})

test(`form controls come from field.tsx (baseline ${BASELINE_DATE})`, () => {
  // §7. 39 local declarations remain; most now alias the shared constants, but
  // the names keep the old pattern alive and two re-spell the control by hand
  // with the wrong radius and no focus ring at all.
  ratchet('local input/label/textarea class constants',
    count(/const\s+(?:input|label|textarea)\w*(?:Class|Cls|Classes)\s*=/), 39,
    'Import FIELD_CONTROL_CLASS etc. from @/lib/utils/field-classes, or use <Field>.')
})

test(`label-caps replaces its own longhand (baseline ${BASELINE_DATE})`, () => {
  // `label-caps` is a real @utility (globals.css) used 303 times; these 256
  // sites spell the same 11px uppercase label out by hand.
  ratchet('text-[11px]', count(/text-\[11px\]/), 256, 'Use the label-caps utility.')
})

test(`colour is converging on tone names (baseline ${BASELINE_DATE})`, () => {
  // The palette now lives in src/lib/ui/tone.ts as thirteen names. The 33
  // *_BADGE maps were converted on 10-17 (324 -> 149): they still return a
  // class STRING, so none of their 71 consumers had to change, but they get it
  // from chipTone() now. What is left is inline chips in components.
  // ⚠ tone.ts itself is excluded: it IS the palette, declared literally in
  // source, which is the shape §12 mandates.
  const files = sourceFiles().filter((f) => !f.endsWith('src/lib/ui/tone.ts'))
  ratchet('raw colour pairs outside tone.ts',
    count(/'[^']*\bbg-[a-z]+-\d+[^']*\btext-[a-z]+-\d+[^']*'/, files), 149,
    'Use a Tone name: <Chip tone="caution">. See src/lib/ui/tone.ts.')
})

test('the slate ramp is not growing — it does not respond to the theme', () => {
  // 572 -> 365 when the *_BADGE maps were converted (10-17). Of the rest, ~90
  // are the print routes and the map, where fixed colours are CORRECT — a print
  // view styled text-foreground would inherit dark mode. The remainder are a
  // dark-mode bug waiting to be noticed.
  ratchet('slate-* utilities', count(/\b(?:bg|text|ring|border|from|to|via)-slate-\d+/), 365,
    'Use the OKLCH neutrals (muted / muted-foreground / border) or tone "neutral". ' +
    'Print routes are the deliberate exception.')
})

test('a touch target is never derived from the spacing scale', () => {
  // ⚠ `h-11` is calc(var(--spacing) * 11). At Tailwind's 0.25rem default that
  // is exactly the 44px minimum; at this app's 0.22rem it is 38.7px. So the
  // density knob silently shrinks every tap target below the floor — it did,
  // to 66 of them, on the one device where it matters. A touch target is a
  // PHYSICAL constraint, so it is written absolutely and is immune to density.
  //
  // The two survivors are the login logo (`h-11 w-auto`), which is decorative
  // and may shrink. Decorative `size-12` icon circles are deliberately out of
  // scope for the same reason.
  const hits = scan(/\b(?:min-h|h|size)-11\b/)
  const nonLogo = hits.filter((h) => !h.file.endsWith('LoginForm.tsx'))
  assert.deepEqual(
    nonLogo.map((h) => `${h.file}:${h.line}`),
    [],
    'use h-[2.75rem] / min-h-[2.75rem] / size-[2.75rem] — 44px, independent of --spacing'
  )
})

// ─── a floor, not a ceiling ──────────────────────────────────────────────────

test('aria-current is only ever added, never removed', () => {
  // The inverse ratchet. There were ZERO before 10-17 — the sidebar's active
  // row was a background colour and nothing else, so a screen reader could not
  // tell which page it was on. Three now (the sidebar and both mobile link
  // sets); this number only goes up.
  const n = count(/aria-current/)
  assert.ok(n >= 3, `aria-current is down to ${n} — an active row needs it`)
})

test('an icon-only button has an accessible name', () => {
  /*
   * A `<button>` whose only child is an icon announces as "button" and nothing
   * else. 17 were fixed on 10-17, including the SEND BUTTON ON THE AGENT — the
   * most-used control in the app's headline feature — and three modal closes in
   * UserAccessManager.
   *
   * ⚠ `title=` COUNTS. An audit reported 34 of these by ignoring it, but
   * `title` IS part of the accessible-name computation; what it does not do is
   * appear on keyboard focus or exist on a phone, which is why new code gets
   * `aria-label` as well.
   *
   * ⚠ AND THE PATTERN IS DELIBERATELY NARROW: the button's children must be
   * EXACTLY one self-closing element. Three broader versions were tried and
   * each cost evidence (§12 — a filter must be measured against the corpus, and
   * every clever version withholds more of it). Looking at the text after the
   * icon flagged all 20 `<Plus/> Add Requirement` buttons; stripping
   * `{expressions}` flagged every `{saving ? 'Saving…' : 'Save'}` button,
   * because the label is a literal INSIDE the expression; counting those
   * literals still flagged the multi-line `{cond ? (<Icon/> Text) : (…)}` form,
   * because a non-greedy brace match stops inside `size={14}`.
   *
   * So this catches only the shape that is unambiguously nameless, and it
   * catches it with no false positives. A button labelled through a conditional
   * is out of scope — that is a real gap, and a narrow check that is trusted
   * beats a broad one that gets muted.
   */
  const bad: string[] = []
  for (const file of sourceFiles('src/components', ['.tsx'])) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/<button\b([^>]*?)>([\s\S]*?)<\/button>/g)) {
      const [, attrs, inner] = m
      if (/aria-label|title=|sr-only/.test(attrs)) continue
      if (!/^<\w+[^<>]*\/>$/.test(inner.trim())) continue
      bad.push(`${file}:${src.slice(0, m.index).split('\n').length}`)
    }
  }
  assert.deepEqual(bad, [], 'give an icon-only button an aria-label')
})
