/**
 * Tone names, and the palette they resolve against.
 *
 * ⚠ IN src/lib, NOT A 'use client' MODULE. Server pages read these to render a
 * chip and client components read them too; every export of a `'use client'`
 * file becomes a client reference, which throws at REQUEST time with neither
 * `tsc` nor the build catching it (CLAUDE.md §12, 07-11).
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * There are 46 distinct bg/text/ring class triples across 192 uses in 12 files
 * (measured 2026-10-17), and they resolve to just 14 hue families. §12 already
 * mandates the shape — "store a tone NAME against a palette declared literally
 * in source, and reject an unknown tone" — and the existing `*_BADGE` maps
 * honour the literal-in-source half. What they lack is the NAME: each map holds
 * the raw classes, so "what colour is a warning here" has 26 answers and no
 * owner, and a map written next year gets a 27th.
 *
 * The vocabulary below is DERIVED from that measurement, not invented (§12:
 * generate the enumeration from the same rows the column references). Hue
 * counts: slate 34, emerald 27, amber 26, blue 17, red 16, violet 15, indigo
 * 12, cyan 9, sky 9, teal 7, rose 7, orange 5. The first five carry meaning in
 * every map that uses them; the rest only ever distinguish one category from
 * another.
 *
 * ── TWO KINDS, AND THE DIFFERENCE MATTERS ────────────────────────────────────
 * `StatusTone` says something is good, waiting, wrong or informational. These
 * resolve to the CSS status tokens, so one class carries both themes and a
 * missing `dark:` variant is impossible.
 *
 * `CategoryTone` says only "this is a different kind from that one" — a sector,
 * a lane, a line of business. These deliberately get NO CSS token: a token
 * called `--violet` is not a semantic improvement on `violet`, and twenty-one
 * more of them is a palette nobody can name. They keep explicit `dark:`
 * variants, in one place, in the dominant spelling the corpus already uses.
 *
 * ⚠ `neutral` IS THE ONE THAT FIXES A BUG. 34 uses of the `slate-*` ramp run
 * beside the OKLCH tokens and do NOT respond to the theme — slate-600 on
 * slate-100 stays a light chip on a dark card. `neutral` resolves to
 * `bg-muted text-muted-foreground ring-border`, which does. It is the single
 * biggest dark-mode correctness win available here, and it is one line.
 */

export const STATUS_TONES = ['positive', 'caution', 'critical', 'severe', 'info', 'neutral'] as const
export const CATEGORY_TONES = ['violet', 'indigo', 'cyan', 'sky', 'teal', 'rose', 'orange'] as const

export type StatusTone = (typeof STATUS_TONES)[number]
export type CategoryTone = (typeof CATEGORY_TONES)[number]
export type Tone = StatusTone | CategoryTone

export const TONES: readonly Tone[] = [...STATUS_TONES, ...CATEGORY_TONES]

/**
 * The palette. Literal class strings — never built by interpolation, because a
 * Tailwind class assembled at runtime is a class Tailwind never generated (§12).
 */
const CHIP: Record<Tone, string> = {
  // Status — the tokens carry both themes, so there is no `dark:` here at all.
  // That absence is the feature: there is no variant left to forget.
  positive: 'bg-positive-surface text-positive ring-positive-edge',
  caution: 'bg-caution-surface text-caution ring-caution-edge',
  critical: 'bg-critical-surface text-critical ring-critical-edge',
  info: 'bg-info-surface text-info ring-info-edge',
  // `severe` is the intensifier the corpus spells as red-100/red-800: a solid
  // fill for the one row that outranks the other red rows. Reserved for that —
  // when every row is red, red has stopped signifying (§12).
  severe: 'bg-critical text-primary-foreground ring-critical',
  // Theme-aware by construction. Replaces the slate ramp.
  neutral: 'bg-muted text-muted-foreground ring-border',

  /*
    Categorical — no meaning, only difference. OUTLINE, NOT FILLED, SINCE
    2026-10-27, and that one word is the whole §4.2 rule:

        a FILLED chip means STATUS; an OUTLINED chip means CATEGORY.

    Until now both were filled, so a sector chip and a "needs attention" chip
    were the same object with different hues, and a screen carrying both asked
    the reader to remember which palette each one came from. Nothing else in
    the app can say "this is a warning" — colour is the only channel a status
    chip has — whereas a category chip always carries its own label and is
    only ever distinguishing one kind from another. So the fill belongs to the
    one that needs it.

    The ring and the ink stay, which is what keeps them legible: `ring-1
    ring-inset` is already on the Chip shell, so this is a transparent fill
    and nothing else moves.
  */
  violet: 'bg-transparent text-violet-700 ring-violet-300 dark:text-violet-300 dark:ring-violet-500/40',
  indigo: 'bg-transparent text-indigo-700 ring-indigo-300 dark:text-indigo-300 dark:ring-indigo-500/40',
  cyan: 'bg-transparent text-cyan-700 ring-cyan-300 dark:text-cyan-300 dark:ring-cyan-500/40',
  sky: 'bg-transparent text-sky-700 ring-sky-300 dark:text-sky-300 dark:ring-sky-500/40',
  teal: 'bg-transparent text-teal-700 ring-teal-300 dark:text-teal-300 dark:ring-teal-500/40',
  rose: 'bg-transparent text-rose-700 ring-rose-300 dark:text-rose-300 dark:ring-rose-500/40',
  orange: 'bg-transparent text-orange-700 ring-orange-300 dark:text-orange-300 dark:ring-orange-500/40',
}

/** Text/icon colour alone, for a figure or a label that is not a chip. */
const INK: Record<Tone, string> = {
  positive: 'text-positive',
  caution: 'text-caution',
  critical: 'text-critical',
  info: 'text-info',
  severe: 'text-critical',
  neutral: 'text-muted-foreground',
  violet: 'text-violet-700 dark:text-violet-300',
  indigo: 'text-indigo-700 dark:text-indigo-300',
  cyan: 'text-cyan-700 dark:text-cyan-300',
  sky: 'text-sky-700 dark:text-sky-300',
  teal: 'text-teal-700 dark:text-teal-300',
  rose: 'text-rose-700 dark:text-rose-300',
  orange: 'text-orange-700 dark:text-orange-300',
}

export function isTone(value: string): value is Tone {
  return Object.prototype.hasOwnProperty.call(CHIP, value)
}

/**
 * Chip classes for a tone. THROWS on an unknown name, deliberately (§12:
 * reject an unknown tone) — the alternative is a chip that silently renders
 * with no colour, which looks like a styling slip rather than a missing case
 * and so never gets reported.
 */
export function chipTone(tone: Tone): string {
  const cls = CHIP[tone]
  if (!cls) throw new Error(`Unknown tone: ${String(tone)}. Expected one of: ${TONES.join(', ')}`)
  return cls
}

/** Ink classes for a tone. Same contract as `chipTone`. */
export function inkTone(tone: Tone): string {
  const cls = INK[tone]
  if (!cls) throw new Error(`Unknown tone: ${String(tone)}. Expected one of: ${TONES.join(', ')}`)
  return cls
}
