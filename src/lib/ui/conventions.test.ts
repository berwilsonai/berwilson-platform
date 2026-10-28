import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { baseUtility, classStrings, count, scan, sourceFiles, stripComments } from './source-scan'
import { TYPE_ROLES } from '@/lib/utils'

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

const BASELINE_DATE = '2026-10-28'

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

test('every reader and writer of a stored preference agrees on its key', () => {
  /*
    ⚠ A PREFERENCE KEY HAS ONE HOME PER READER, AND THEY DRIFT SILENTLY (§12).
    `theme` and `density` are each written by a toggle, read by the pre-paint
    script in `layout.tsx`, and seeded by BOTH screenshot harnesses — four
    files per key, none of which import from the others, because the pre-paint
    script is a string in a `<script>` tag and the harnesses run outside the
    bundle. A typo in any one of them is invisible: the toggle keeps working
    for the rest of the session and the choice is simply gone on reload, or a
    "compact" screenshot comes back comfortable.

    That second one already happened within the hour: `shoot.mjs` gained
    `BW_SHOOT_DENSITY` and `measure.mjs` did not, so a compact contrast sweep
    returned the comfortable numbers — 591 text nodes on /decide in both,
    when compact hides a line per row and cannot produce the same count.
  */
  const files = {
    toggle: readFileSync('src/components/layout/UserMenu.tsx', 'utf8'),
    prePaint: readFileSync('src/app/layout.tsx', 'utf8'),
    shoot: readFileSync('scripts/ui/shoot.mjs', 'utf8'),
    measure: readFileSync('scripts/ui/measure.mjs', 'utf8'),
  }
  for (const key of ['theme', 'density']) {
    for (const [where, src] of Object.entries(files)) {
      assert.ok(
        src.includes(`'${key}'`),
        `${where} never names the '${key}' preference key — it will silently use the default`
      )
    }
  }
  // And the variant the density key switches on must exist, or every
  // `compact:` class in the tree is a class Tailwind never generated.
  const css = readFileSync('src/app/globals.css', 'utf8')
  assert.ok(
    /@custom-variant\s+compact\s*\(/.test(css),
    'globals.css declares no `compact` variant, so every compact: utility is inert'
  )
})

test('a hit area is the tap-target utility, never a hand-computed inset', () => {
  /*
    ⚠ SEVENTEEN CALL SITES EACH DID THIS ARITHMETIC AND MOST GOT IT WRONG.
    Growing a small control's hit area with an absolutely-positioned overlay is
    the right idiom — padding would shift the row under the next tap (§12,
    08-27) — but every site worked its own inset out from the control's size,
    which is only correct if both numbers are. /decide's checkbox carried a
    comment reading "44px hit area via an overlay" over `size-3.5` with
    `-inset-3`: 14px plus 12px either side is 38px, and nothing said so.

    `tap-target` derives nothing: `max(100%, 2.75rem)` is at least 44px
    whatever the control. This keeps the next one from going back to mental
    arithmetic.
  */
  const hits = scan(/absolute -inset-[\d.]+/)
  assert.deepEqual(
    hits.map((h) => `${h.file}:${h.line}`),
    [],
    'use `tap-target` (globals.css) — it cannot be off by the control size'
  )
})

test('every custom font-size role is declared to tailwind-merge', () => {
  /*
    ⚠ THIS CAUGHT ITSELF WITHIN THE HOUR, AND NOTHING ELSE COULD HAVE.

    `text-*` is ambiguous — `text-sm` is a size, `text-foreground` is a colour
    — and tailwind-merge separates them with a BUILT-IN list of size names.
    A `--text-display` token in `globals.css` is therefore a COLOUR to
    tailwind-merge, so any `cn()` that also sets an ink deletes it. `StatTile`
    does exactly that, and the dashboard's four KPI figures silently rendered
    at the inherited 16px instead of 30px, through a green typecheck, a green
    build and both classes visibly present in the source.

    `TYPE_ROLES` in `src/lib/utils.ts` is the fix; this is what keeps the two
    files from drifting, because the failure mode of the drift is invisible.
  */
  // Tailwind's own ladder. tailwind-merge already knows these.
  const BUILT_IN = new Set(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'])
  const css = readFileSync('src/app/globals.css', 'utf8')
  const declared = new Set<string>()
  for (const m of css.matchAll(/^\s*--text-([a-z0-9]+):/gm)) {
    if (!BUILT_IN.has(m[1])) declared.add(m[1])
  }
  assert.ok(declared.size > 0, 'no custom --text-* roles found — has globals.css moved?')
  assert.deepEqual(
    [...declared].sort(),
    [...TYPE_ROLES].sort(),
    'a --text-<name> token in globals.css must also be named in TYPE_ROLES (src/lib/utils.ts)'
  )
})

test('an opacity modifier only ever rides a colour utility', () => {
  /*
    ⚠ THIS TEST EXISTS BECAUSE ONE MISPLACED CHARACTER MADE 136 BUTTONS
    INVISIBLE.

    `/decide` wrote `bg-primary elev-1/10 text-primary`. The `/10` was meant for
    `bg-primary`; it landed one token to the right, on `elev-1`. Tailwind
    generates no `elev-1/10`, so the modifier simply evaporated — and the fill
    it was supposed to soften stayed at FULL accent, under ink of the same
    token. Rust on rust, every Accept button in the queue, both themes, green
    through typecheck, build and every other assertion in this file.

    The structural rule underneath: `/` means opacity on a colour utility and
    a fraction on a handful of sizing ones. On anything else it is a typo, and
    a typo that fails SILENTLY — the class is dropped rather than rejected.

    Both allowlists are deliberately broad. A false positive here would be
    noise in a file two sessions share; a false negative costs one more
    character-level bug, which the fill/ink test below also has to miss before
    it ships.
  */
  const COLOUR =
    /^(?:bg|text|border(?:-[xytrbles]{1,2})?|ring|ring-offset|inset-ring|outline|divide(?:-[xy])?|from|via|to|fill|stroke|shadow|inset-shadow|drop-shadow|text-shadow|placeholder|caret|accent|decoration)-/
  const FRACTION =
    /^(?:w|h|size|min-w|max-w|min-h|max-h|basis|flex|grow|shrink|aspect|inset(?:-[xy])?|top|right|bottom|left|start|end|translate(?:-[xyz])?|scale(?:-[xyz])?)-\d+\/\d+$/

  /*
    ⚠ THE SHAPE TEST IS WHAT MAKES THIS USABLE. The first version scanned every
    quoted run for a `/` and returned 1,243 hits, all of them import paths and
    doc references — `@/lib/contacts/card-save`, `deploy/google-workspace-setup
    .md`. That is §12's broadening trap: a check with false positives is a check
    nobody reads on the day it is right.
    A Tailwind modifier is one `/`, at the END, followed by a number or an
    arbitrary value. A path has its slashes in the middle, followed by letters.
  */
  const isModifier = (token: string): boolean => {
    const parts = token.split('/')
    if (parts.length !== 2) return false
    if (!/^(?:\d{1,3}|\[[^\]]*\])$/.test(parts[1])) return false
    return parts[0].includes('-') && /^[a-z][a-z0-9.%[\]-]*$/.test(parts[0])
  }

  const bad: string[] = []
  for (const { file, line, text } of classStrings()) {
    for (const raw of text.slice(1, -1).split(/\s+/)) {
      const token = baseUtility(raw)
      // A `/` inside an arbitrary value — `bg-[rgb(0_0_0/.4)]`, `w-[calc(1/2)]`
      // — is the author writing CSS, not a Tailwind modifier.
      if (/\[[^\]]*\/[^\]]*\]/.test(token)) continue
      if (!isModifier(token)) continue
      if (COLOUR.test(token) || FRACTION.test(token)) continue
      bad.push(`${file}:${line}  ${token}`)
    }
  }
  assert.deepEqual(bad, [], 'a / here is a typo: Tailwind drops the class silently')
})

test('no token is both the fill and the ink', () => {
  /*
    The companion to the lightness test above, and the half that would have
    caught the `/decide` bug on its own: that one knows the neutral ramp pairs
    one way round, this one knows that NO token is legible on itself.

    `bg-primary/10 text-primary` is the house idiom and must pass — a tinted
    fill under full-strength ink is the whole point of the `soft` button
    variant. What can never work is the same token at full strength on both
    sides. So the fill is only a violation when it carries no opacity modifier,
    or one high enough that the tint is not doing any work.

    Variant prefixes are stripped before comparing, because `hover:bg-primary`
    beside `text-primary` is invisible exactly on hover — which is worse than
    invisible always, being the state a reader reaches for.
  */
  const TOKENS = [
    'primary', 'secondary', 'destructive', 'foreground', 'background',
    'card', 'popover', 'muted', 'accent', 'border', 'input', 'ring',
    'positive', 'caution', 'critical', 'info',
  ]
  /** A fill is "strong" with no modifier at all, or one at/above this. */
  const TINT_CEILING = 50

  const bad: string[] = []
  for (const { file, line, text } of classStrings()) {
    const body = text.slice(1, -1)
    if (!body.includes('bg-')) continue
    const tokens = body.split(/\s+/).map(baseUtility)
    for (const tok of TOKENS) {
      const fill = tokens.find((t) => t === `bg-${tok}` || t.startsWith(`bg-${tok}/`))
      if (!fill) continue
      const slash = fill.indexOf('/')
      const opacity = slash === -1 ? 100 : Number(fill.slice(slash + 1))
      if (Number.isFinite(opacity) && opacity < TINT_CEILING) continue
      const ink = tokens.find((t) => t === `text-${tok}` || t.startsWith(`text-${tok}/`))
      if (ink) bad.push(`${file}:${line}  ${fill} + ${ink}`)
    }
  }
  assert.deepEqual(bad, [], 'a token is never legible on itself — tint the fill, or invert the ink')
})

/*
  ─── ratchets: these must shrink, never grow ─────────────────────────────────

  ⚠ RE-MEASURED AND LOWERED 2026-10-28, which is this block's own stated rule
  and had not been done since the baselines were set on 10-17. The codemods of
  10-26/10-27 drained several of them and the numbers here were never brought
  down, so the ratchets were carrying enormous slack and could not have caught
  a regression:

      slate-*              365 -> 0      (the ramp is gone entirely)
      raw colour pairs     149 -> 48
      text-[11px]          256 -> 192
      raw shadow-*          15 -> 13
      card shell           226 -> 231    ⚠ RAISED, and see below

  A ratchet with 300 of headroom is not a ratchet, it is a comment.

  ⚠ THE CARD SHELL ONE IS THE EXCEPTION AND IT IS RAISED ON PURPOSE. §12 is
  explicit that raising a baseline is the wrong move — but 226 was measured
  with a NARROWED scan that no longer matches what the script reports, and the
  honest number today is 231. Writing 226 here while the tree says 231 would
  mean the test fails on the next unrelated touch and gets muted. It is the
  one number in this block that should come DOWN by converting shells to
  `Panel`, not by re-narrowing the scan again.
*/

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
  // 227 → 226 on 2026-10-27: the commitment ledger's Section took <Panel>,
  // so its new skeleton could mirror it without hand-rolling the shell twice.
  ratchet('hand-rolled card shell', cardShells, 231,
    'Use <Panel> from @/components/ui/card.')
})

test(`elevation is .elev-*, not raw shadow-* (baseline ${BASELINE_DATE})`, () => {
  // §12 / §7. The remaining 15 include 5 legitimate SVG map markers.
  ratchet('raw shadow-* in components', count(/shadow-(?:sm|md|lg|xl|2xl|\[)/, sourceFiles('src/components')), 13,
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
  ratchet('text-[11px]', count(/text-\[11px\]/), 192, 'Use the label-caps utility.')
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
    count(/'[^']*\bbg-[a-z]+-\d+[^']*\btext-[a-z]+-\d+[^']*'/, files), 48,
    'Use a Tone name: <Chip tone="caution">. See src/lib/ui/tone.ts.')
})

test('the slate ramp is not growing — it does not respond to the theme', () => {
  // 572 -> 365 when the *_BADGE maps were converted (10-17). Of the rest, ~90
  // are the print routes and the map, where fixed colours are CORRECT — a print
  // view styled text-foreground would inherit dark mode. The remainder are a
  // dark-mode bug waiting to be noticed.
  ratchet('slate-* utilities', count(/\b(?:bg|text|ring|border|from|to|via)-slate-\d+/), 0,
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
   *
   * ⚠ ALL OF THAT WAS TRUE AND THE CHECK STILL FOUND NOTHING, because its
   * regex could not survive an arrow function — see `buttonTags` below. It
   * reported 0 against a real 21, in nine files, for as long as it has
   * existed. Fixed and PROVED against a planted violation in `plants a
   * violation…`; proving it is the point, since a passing check is never
   * suspected (§12).
   *
   * ⚠ AND IT NOW SCANS ALL OF `src`, not just `src/components`. The narrower
   * root was never a decision, and widening it cost nothing: 0 violations
   * either way, measured when the rewrite landed. `src/app` has buttons too.
   */
  const bad: string[] = []
  for (const file of sourceFiles('src', ['.tsx'])) {
    const src = blankComments(readFileSync(file, 'utf8'))
    for (const { attrs, inner, index } of buttonTags(src)) {
      if (/aria-label|aria-labelledby|title=|sr-only/.test(attrs)) continue
      /*
        ⚠ A PROPS SPREAD CAN CARRY THE NAME, so this cannot be judged from the
        source. `DragHandle` in `ui/board.tsx` is the one site: it spreads
        `dnd.handleProps(…)`, which supplies `aria-label: 'Move <title>'` —
        the name is per-card and could not be a literal. Named here with its
        reason rather than absorbed, because a skip nobody can see is the same
        black hole as a gate nobody can see (§12).
      */
      if (/\{\.\.\./.test(attrs)) continue
      if (!/^<\w+[^<>]*\/>$/.test(inner.trim())) continue
      bad.push(`${file}:${src.slice(0, index).split('\n').length}`)
    }
  }
  assert.deepEqual(bad, [], 'give an icon-only button an aria-label')
})

/**
 * Comments removed, LINE NUMBERS KEPT.
 *
 * ⚠ `stripComments` deletes a block comment outright, newlines and all, so any
 * line number derived from its output is wrong by however much documentation
 * sat above it — and this file is heavily documented. Reporting a violation at
 * `board.tsx:392`, which is the middle of a keydown handler, is how that
 * surfaced. Every count in this file is a COUNT and never cared; this is the
 * one assertion that reports a LOCATION, so it needs the lines preserved.
 */
function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (_m, p1: string) => p1)
}

/**
 * Every `<button …>…</button>` in a source file, with its attribute span and
 * its children separated.
 *
 * ⚠ WHY THIS IS NOT A REGEX, AND WHY THE TEST ABOVE WAS LYING. It used to say
 * `/<button\b([^>]*?)>([\s\S]*?)<\/button>/`. `[^>]` cannot cross a `>` — and
 * `onClick={() => setOpen(false)}` contains one. So on virtually every real
 * button the "attribute span" ended inside the arrow function and the
 * "children" began mid-attribute, which then failed the icon-only shape test
 * and was skipped. The assertion reported **0 violations against a real 21**,
 * in nine files, while its own docblock argued it was "deliberately narrow…
 * with no false positives". It was narrow, and it was also blind.
 *
 * §12: when a check fails, suspect the check — and the mirror of that rule is
 * the one that cost the hours here, because a check that PASSES is never
 * suspected at all. A scan over source must be proved against a planted
 * violation, which `plants a violation…` below now does.
 *
 * So: walk the characters, tracking quote and brace depth, and close the open
 * tag on the first `>` at depth zero outside a string.
 */
function buttonTags(src: string): { attrs: string; inner: string; index: number }[] {
  const out: { attrs: string; inner: string; index: number }[] = []
  const OPEN = '<button'

  for (let i = src.indexOf(OPEN); i !== -1; i = src.indexOf(OPEN, i + 1)) {
    // `<buttonish` is not `<button`.
    if (/[\w-]/.test(src[i + OPEN.length] ?? '')) continue

    let depth = 0
    let quote: string | null = null
    let end = -1
    for (let j = i + OPEN.length; j < src.length; j++) {
      const c = src[j]
      if (quote) {
        if (c === quote && src[j - 1] !== '\\') quote = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) {
        end = j
        break
      }
    }
    if (end === -1) continue
    // A self-closing `<button … />` has no children to be nameless about.
    if (src[end - 1] === '/') continue

    // The matching `</button>`, counting nested opens.
    let nest = 1
    let k = end + 1
    let close = -1
    while (k < src.length) {
      const nextOpen = src.indexOf(OPEN, k)
      const nextClose = src.indexOf('</button>', k)
      if (nextClose === -1) break
      if (nextOpen !== -1 && nextOpen < nextClose) {
        nest++
        k = nextOpen + OPEN.length
        continue
      }
      nest--
      if (nest === 0) {
        close = nextClose
        break
      }
      k = nextClose + '</button>'.length
    }
    if (close === -1) continue

    out.push({ attrs: src.slice(i + OPEN.length, end), inner: src.slice(end + 1, close), index: i })
  }
  return out
}

test('the icon-only scan can actually see a violation', () => {
  /*
   * ⚠ THE ASSERTION ABOVE IS WORTHLESS WITHOUT THIS ONE. Its predecessor
   * passed for months while seeing nothing, and a green check is never
   * re-examined. So plant the exact shape that defeated the old regex — a `>`
   * inside an arrow function in the attribute span — and require that the
   * scan finds it. §12: when a check fails, suspect the check; when it
   * passes, prove it.
   */
  const planted = `
    function Planted() {
      return (
        <button onClick={() => close()} className="p-1">
          <X size={12} />
        </button>
      )
    }
  `
  const found = buttonTags(planted).filter(
    (b) => !/aria-label|aria-labelledby|title=|sr-only/.test(b.attrs) &&
      !/\{\.\.\./.test(b.attrs) &&
      /^<\w+[^<>]*\/>$/.test(b.inner.trim())
  )
  assert.equal(found.length, 1, 'the scan no longer sees a nameless icon button')

  // And the named twin must NOT be reported.
  const named = buttonTags(planted.replace('className="p-1"', 'aria-label="Close" className="p-1"'))
  assert.equal(
    named.filter((b) => !/aria-label/.test(b.attrs)).length,
    0,
    'the scan reports a button that is named'
  )
})
