#!/usr/bin/env node
/**
 * Hand-rolled buttons → the shape `ui/button.tsx` already defines.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Measured 2026-10-27, after Richard looked at a shipped "complete overhaul"
 * and said *"I am not seeing different button shapes, layouts, etc."* He was
 * right, and the reason is structural rather than aesthetic:
 *
 *   34 files import <Button>.  274 button class strings are hand-rolled.
 *
 * So when 10-26 raised the primitive's sizes and padding — explicitly to stop
 * buttons looking "visibly timid next to the chunky primary actions that make
 * Jobber and Attio feel like products" — that change reached 34 files and
 * missed 274 buttons. Exactly the same failure as the 2,214 raw colour classes
 * that made two palette re-skins invisible: A PRIMITIVE ONLY STYLES WHAT USES
 * IT, and most of this app does not use it.
 *
 * The divergence, counted:
 *   rounded-md  264   vs the primitive's rounded-lg  (6.4px against 8px — two
 *                     button radii on every screen, and neither matches Panel)
 *   h-8          98   vs the primitive's default h-9
 *   text-xs     120   vs the primitive's text-sm
 *   elev-1        2   of the filled primary buttons, against all of them
 *
 * None of that is taste. It is one component's shape, written out by hand 274
 * times and then not updated with it.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 * Only class strings that are unambiguously a button: `inline-flex` + a height
 * + `rounded-md`, AND a button-ish surface (a fill, a border, or a hover).
 * That last clause matters — `inline-flex … rounded-md` alone also describes
 * chips, avatars and icon wells, which must not grow.
 *
 * ⚠ `h-7` IS LEFT ALONE. It is the primitive's own `xs` size and a deliberate
 * choice where it appears (dense toolbars, inline row actions).
 * ⚠ So is any absolute touch target (`h-[2.75rem]`) — a physical constraint,
 * per the standing rule in globals.css — though its `sm:` partner is raised.
 *
 * Run: node scripts/codemod/button-shape.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const WRITE = process.argv.includes('--write')

/** Quoted runs only — a class string never spans a quote. */
const STRING_RE = /"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g

/** Does this class string describe a button rather than a chip or an icon well? */
function isButton(s) {
  if (!s.includes('inline-flex') && !s.includes('flex items-center')) return false
  if (!/\brounded-md\b/.test(s)) return false
  if (!/\bh-(7|8|9|10)\b|\bh-\[2\.75rem\]/.test(s)) return false
  // A surface: a fill, a border, or something that reacts to a pointer.
  return /\bbg-(primary|foreground|card|background|muted|secondary|destructive|critical)\b|\bborder border-(input|border)\b|\bhover:/.test(s)
}

const files = execSync("git ls-files 'src/**/*.tsx'", { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((f) => f && !f.endsWith('.test.tsx'))

const counts = { radius: 0, height: 0, text: 0, lift: 0, pad: 0 }
let touched = 0

for (const file of files) {
  const before = readFileSync(file, 'utf8')
  const after = before.replace(STRING_RE, (s) => {
    if (!isButton(s)) return s
    let out = s

    // One radius ladder: a button is `rounded-lg`, the same as Panel.
    if (/\brounded-md\b/.test(out)) {
      out = out.replace(/\brounded-md\b/, 'rounded-lg')
      counts.radius++
    }
    // The primitive's default height. `sm:h-8` is the desktop half of a touch
    // target and moves with it; bare `h-8` is just the old default.
    if (/\bsm:h-8\b/.test(out)) {
      out = out.replace(/\bsm:h-8\b/, 'sm:h-9')
      counts.height++
    } else if (/\bh-8\b/.test(out)) {
      out = out.replace(/\bh-8\b/, 'h-9')
      counts.height++
    }
    // The primitive sets `text-sm`. 120 of these said `text-xs`, which is what
    // makes a button read as a label rather than a control.
    if (/\btext-xs\b/.test(out)) {
      out = out.replace(/\btext-xs\b/, 'text-sm')
      counts.text++
    }
    // `px-3` on a primary action was the tightest thing on the screen (the
    // primitive uses px-3.5).
    if (/\bpx-3\b/.test(out)) {
      out = out.replace(/\bpx-3\b/, 'px-3.5')
      counts.pad++
    }
    // Every filled button in the primitive carries the quietest rung of the
    // elevation ladder. Two of these did.
    if (/\bbg-(primary|foreground)\b/.test(out) && !/\belev-1\b/.test(out)) {
      out = out.replace(/\b(bg-(?:primary|foreground))\b/, '$1 elev-1')
      counts.lift++
    }
    return out
  })
  if (after !== before) {
    touched++
    if (WRITE) writeFileSync(file, after)
  }
}

console.log(
  `${WRITE ? 'rewrote' : 'would rewrite'} ${touched} files\n` +
    `  radius md→lg   ${counts.radius}\n` +
    `  height  →h-9   ${counts.height}\n` +
    `  text xs→sm     ${counts.text}\n` +
    `  padding →px-3.5 ${counts.pad}\n` +
    `  lift added     ${counts.lift}`
)
