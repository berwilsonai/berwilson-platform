#!/usr/bin/env node
/**
 * Raw Tailwind palette classes → the app's own tokens.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Measured 2026-10-27: 2,214 raw `bg|text|border|ring-<family>-<shade>` classes
 * across 135 files, 950 of them `dark:` variants. The OKLCH palette in
 * globals.css was re-derived twice in two days and neither pass could be seen,
 * because MOST OF THE APP'S COLOUR NEVER CONSULTED IT — §12's "a token themes
 * only what READS it", at scale. A `text-red-600 dark:text-red-400` pair is a
 * second palette with its own hue, its own contrast and its own dark mode, and
 * there were six of them running beside the real one.
 *
 * ── WHAT IT CONVERTS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────
 * Only the families `src/lib/ui/tone.ts` declares as STATUS tones:
 *   red            → critical      emerald, green → positive
 *   amber, yellow  → caution       blue           → info
 *   slate/gray/zinc/neutral/stone  → the neutrals (foreground/muted/border)
 *
 * The CategoryTones — violet, indigo, cyan, sky, teal, rose, orange — are left
 * exactly as they are. That is tone.ts's own documented decision: they say only
 * "this kind differs from that kind", and `--violet` is not a semantic
 * improvement on `violet`. Converting them would invent twenty-one tokens
 * nobody can name.
 *
 * ── THE SECOND HALF IS THE POINT ────────────────────────────────────────────
 * After mapping, `text-red-600 dark:text-red-400` becomes `text-critical
 * dark:text-critical` — and the `dark:` half is then DROPPED, because a status
 * token already carries both themes. That is what makes a missing `dark:`
 * variant impossible rather than merely discouraged, and it is why the class
 * count falls by far more than the number of distinct colours involved.
 *
 * Run: node scripts/codemod/tokenise-colours.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const WRITE = process.argv.includes('--write')

/** family → status tone. Derived from the hue counts in tone.ts's own header. */
const STATUS = {
  red: 'critical',
  amber: 'caution',
  yellow: 'caution',
  emerald: 'positive',
  green: 'positive',
  blue: 'info',
}

/** The neutral ramp answers a different question per utility, so it maps per utility. */
function neutral(util, shade) {
  const n = Number(shade)
  // 700+ in light mode is body ink; everything else on the ramp is secondary
  // text. The 200/300 end only ever appears as a `dark:` variant of one of
  // those, and gets dropped by the dedupe pass below.
  if (util === 'text') return n >= 700 ? 'text-foreground' : 'text-muted-foreground'
  /*
    ⚠ THIS LINE SHIPPED A BUG AND THE FIX IS THE CALLER'S, NOT THIS FUNCTION'S.
    It assumed the 800–950 end of the neutral ramp only ever appears as the
    `dark:` half of a tinted surface. It does not: `bg-slate-900 text-white` is
    a DARK FILL IN LIGHT MODE — a print button, a numbered bullet — and sending
    it to `bg-muted` made 13 controls white-on-near-white, i.e. invisible. They
    were repaired to `bg-foreground text-background`.

    Shade alone cannot tell the two apart; the companion `text-white` can. If
    this is ever re-run, grep the result for `bg-muted` sharing a class string
    with `text-white` before believing it.
  */
  if (util === 'bg') return n >= 400 && n <= 700 ? 'bg-muted-foreground' : 'bg-muted'
  return `${util}-border`
}

function statusClass(util, tone, shade) {
  const n = Number(shade)
  if (util === 'text') return `text-${tone}`
  if (util === 'bg') {
    // A mid shade on a background is a SOLID fill — a dot, a bar, a filled
    // badge — not a tinted block. Those take the ink colour, not the surface.
    if (n >= 400 && n <= 700) return `bg-${tone}`
    return `bg-${tone}-surface`
  }
  return `${util}-${tone}-edge` // border / ring
}

const CLASS_RE =
  /\b(dark:)?(bg|text|border|ring)-(red|amber|yellow|emerald|green|blue|slate|gray|zinc|neutral|stone)-(\d{2,3})\b/g

/** A maximal run of class-ish words, so `dark:` dedupe stays inside one string. */
const RUN_RE = /[-\w:[\]/.%]+(?:[ \n\t]+[-\w:[\]/.%]+)*/g
const TOKEN_HEAD =
  /^(bg|text|border|ring)-(critical|caution|positive|info|muted-foreground|muted|foreground|border)(\/\d+)?$/

const files = execSync("git ls-files 'src/**/*.tsx'", { encoding: 'utf8' })
  .trim()
  .split('\n')
  // A test file holds banned patterns as DATA (§12 — a scan that includes
  // itself measures its own documentation).
  .filter((f) => f && !f.endsWith('.test.tsx'))

let totalMapped = 0
let totalDropped = 0
let touched = 0
for (const file of files) {
  const before = readFileSync(file, 'utf8')
  let mapped = 0
  let after = before.replace(CLASS_RE, (_whole, dark, util, fam, shade) => {
    const out = STATUS[fam] ? statusClass(util, STATUS[fam], shade) : neutral(util, shade)
    mapped++
    return `${dark ?? ''}${out}`
  })
  // Drop a `dark:` variant whose base already appears in the same class run.
  //
  // ⚠ TWO SHAPES, AND THE SECOND IS THE ONE THAT MATTERED. The plain duplicate
  // (`text-critical dark:text-critical`) is obvious. The other is a dark
  // override written in the OLD idiom and left pointing at the new token —
  // `bg-caution-surface … dark:bg-caution/15`. That is not a duplicate, it is
  // worse: a token whose whole job is to carry both themes, overridden in one
  // of them by an arbitrary alpha nobody measured. 38 of those survived the
  // first pass because the slash made them look like a different class.
  let dropped = 0
  after = after.replace(RUN_RE, (run) => {
    if (!run.includes('dark:')) return run
    const words = run.split(/(\s+)/)
    const base = new Set(words.filter((w) => TOKEN_HEAD.test(w)))
    /** `bg-caution-surface` and `ring-caution-edge` → the tone they already theme. */
    const themed = new Set(
      words
        // ⚠ THE BASE MAY CARRY ITS OWN ALPHA (`bg-positive-surface/60`), which
        // is how 11 of these slipped past the first attempt at this rule.
        .map((w) => /^(bg|ring|border|text)-(positive|caution|critical|info)(-surface|-edge)?(\/\d+)?$/.exec(w))
        .filter(Boolean)
        .map((m) => `${m[1]}-${m[2]}`)
    )
    if (!base.size && !themed.size) return run
    const kept = []
    for (const w of words) {
      if (w.startsWith('dark:')) {
        const bare = w.slice(5)
        const over = /^(bg|ring|border|text)-(positive|caution|critical|info)(-surface|-edge)?(\/\d+)?$/.exec(bare)
        if (base.has(bare) || (over && themed.has(`${over[1]}-${over[2]}`))) {
          dropped++
          if (/^\s+$/.test(kept.at(-1) ?? '')) kept.pop()
          continue
        }
      }
      kept.push(w)
    }
    return kept.join('')
  })
  if (after !== before) {
    touched++
    totalMapped += mapped
    totalDropped += dropped
    if (WRITE) writeFileSync(file, after)
  }
}
console.log(
  `${WRITE ? 'rewrote' : 'would rewrite'} ${touched} files · ${totalMapped} classes mapped · ${totalDropped} redundant dark: variants dropped`
)
