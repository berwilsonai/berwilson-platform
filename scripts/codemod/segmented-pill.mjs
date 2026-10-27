#!/usr/bin/env node
/**
 * Active tab/filter states: near-black slab → raised white pill.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Measured 2026-10-27, on screenshots rather than on grep. Every view switcher
 * in the app painted its selected segment as a solid block — `bg-foreground
 * text-background` (near-black) or `bg-primary text-primary-foreground`
 * (terracotta). On the dashboard that put THREE filled blocks in one row above
 * the project list, none of which was the page's actual button; on /contacts
 * two more sat beside the real "Add Contact". When a view switcher is as loud
 * as a primary action, nothing on the screen reads as the thing to press.
 *
 * Attio, Linear and Domo all use the same alternative, and it is the one this
 * app already had the tokens for: a grey track with the selected segment
 * lifted to the CONTENT plane — card colour plus the quietest shadow on the
 * ladder. "Selected" without spending the one colour the palette has.
 *
 * ── SCOPE: THE TERNARY TRUE-BRANCH ONLY ─────────────────────────────────────
 * ⚠ The same class string is also how a real BUTTON is spelled here
 * (`inline-flex … h-9 px-4 rounded-md bg-foreground text-background
 * hover:bg-foreground/90`), and those must NOT change — a near-black button is
 * a deliberate secondary action. The discriminator is syntactic and cheap: a
 * selected-state class is the true branch of a ternary, a button's is a plain
 * string in `className`. This matches `? 'bg-foreground text-background…'`
 * and nothing else.
 *
 * The `bg-primary` switchers were converted by hand at the same time — there
 * were six, each with a different false branch, and a regex that handled all
 * six would have been looser than reading them.
 *
 * ── ⚠ AND IT WAS TOO BROAD THE FIRST TIME. READ THIS BEFORE RE-RUNNING ──────
 * Syntax told it which strings were selected-states; it could not tell which
 * of those sat in a TRACK. Nine of the eleven were loose filter chips standing
 * on the canvas — `/decide` categories, diligence categories, investor
 * requirements — and a pill has nothing to lift off there: `--card` is ΔL
 * 0.045 from `--muted`, which is not enough on its own to say "this one is
 * selected" when the chips are a metre apart in a wrapping row. Those nine
 * were reverted by hand to the near-black fill, which is a legible and
 * entirely legitimate idiom for a standalone filter chip (Attio and Linear
 * both use it) and was never the thing that broke the hierarchy.
 *
 * So the rule this encodes is narrower than the regex: A PILL BELONGS TO A
 * SEGMENTED TRACK. If you re-run this, check each hit for a parent with a
 * background of its own, and revert the ones without.
 *
 * Run: node scripts/codemod/segmented-pill.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const WRITE = process.argv.includes('--write')

// Keep any trailing classes the site carried (e.g. `ring-transparent`).
const RE = /\?(\s*)'bg-foreground text-background([^']*)'/g
const PILL = "'bg-card text-foreground font-medium elev-1"

const files = execSync("git ls-files 'src/**/*.tsx'", { encoding: 'utf8' }).trim().split('\n').filter(Boolean)

let sites = 0
let touched = 0
for (const file of files) {
  const before = readFileSync(file, 'utf8')
  const after = before.replace(RE, (_m, ws, rest) => {
    sites++
    return `?${ws}${PILL}${rest}'`
  })
  if (after !== before) {
    touched++
    if (WRITE) writeFileSync(file, after)
  }
}
console.log(`${WRITE ? 'rewrote' : 'would rewrite'} ${touched} files · ${sites} active-state slabs → pills`)
