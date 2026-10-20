/**
 * Render the attention list and assert what a reader will actually see.
 *
 * ⚠ /attention IS BEHIND AUTH, SO A CURL RETURNS THE SAME 307 WHETHER IT
 * ANSWERS OR THROWS (§12). This renders the client directly, across every
 * category and every urgency band, with the input shapes that break a list: a
 * null project, a zero score, a 100 score, and an item in a kind the chip row
 * must still show because it is the active filter.
 *
 * Run: npx tsx scripts/verify-attention-render.tsx
 *
 * ⚠ `.tsx` under tsx, never `.mts` under deploy/register.mjs — see
 * verify-mspa-render.tsx for the two failures that causes.
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import AttentionList, {
  type AttentionRow,
  type DismissedRow,
} from '../src/components/attention/AttentionList'
import {
  ATTENTION_DISMISS_DAYS,
  ATTENTION_KINDS,
  attentionDeleteTarget,
  urgencyBand,
} from '../src/lib/attention-kinds'

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const UUID = '4f48f348-39b6-4d5a-9a98-92218501fd05'

/*
  One row per kind, cycling the urgency bands, half of them with no project.

  ⚠ THE ID IS THE REAL PREFIXED KEY, NOT `${category}-${i}`. The quick actions
  are routed by parsing that key, so a synthetic id would make every row
  delete-less and the whole delete half of this check would pass by rendering
  nothing. §12: a fixture that builds the field directly cannot catch a producer
  that never fills it — three week-ahead tests covered a text that could not
  name a meeting because each injected the shape the real fetch never produced.
*/
const rows: AttentionRow[] = ATTENTION_KINDS.map((k, i) => ({
  id: `${k.idPrefixes[0]}${UUID}`,
  category: k.category,
  urgency: [100, 80, 60, 30, 0][i % 5],
  title: `${k.label} item ${i}`,
  detail: `${i * 3} days`,
  project_id: i % 2 === 0 ? '11111111-1111-1111-1111-111111111111' : null,
  project_name: i % 2 === 0 ? 'Steelton — Cleveland-Cliffs (PA)' : '—',
  age_days: i * 3,
  due_date: i % 3 === 0 ? '2026-10-17' : null,
}))

const noop = () => {}
const props = {
  dismissed: [] as DismissedRow[],
  active: null,
  view: 'open' as const,
  busy: new Set<string>(),
  onFilter: noop,
  onView: noop,
  onOpen: noop,
  onDismiss: noop,
  onDelete: noop,
  onRestore: noop,
}

console.log('\nAttention list — every kind, every band\n')

const markup = renderToStaticMarkup(React.createElement(AttentionList, { ...props, items: rows }))

for (const k of ATTENTION_KINDS) {
  check(`${k.category} renders its label`, markup.includes(k.label))
}

// The score the engine has always produced and nothing ever showed.
check('urgency scores are printed', rows.every((r) => markup.includes(`>${r.urgency}<`)))

// A chip count per kind, derived — every kind here has exactly one item.
const counts = markup.match(/class="tnum ml-1">1</g) ?? []
check('each kind chip carries its own count', counts.length === ATTENTION_KINDS.length,
  `found ${counts.length}, expected ${ATTENTION_KINDS.length}`)
check('the "Everything" chip carries the total', markup.includes(`>${rows.length}<`))

// Banding: only `now` is tinted, so red keeps meaning something (§12).
const tinted = (markup.match(/bg-critical-surface\/40/g) ?? []).length
const expectedNow = rows.filter((r) => urgencyBand(r.urgency) === 'now').length
check('only the `now` band is tinted', tinted === expectedNow, `${tinted} tinted vs ${expectedNow} at now`)
check('the `soon` band gets a border, not a fill', markup.includes('border-l-caution'))

/*
  ⚠ THE KEYBOARD FALLBACK IS NOW `group-focus-within`, NOT `group-focus-visible`,
  AND THE DIFFERENCE IS LOAD-BEARING. `group-focus-visible` asks whether the
  GROUP ELEMENT itself is focused, which worked while the whole row was a
  `<Link>`. The row is a div now (a button inside an anchor is invalid HTML and
  fires both), so nothing can ever focus the group — the old variant would have
  been present in the class string, passed this check, and revealed nothing to a
  keyboard user. `focus-within` fires when a DESCENDANT takes focus, which is
  what a row of buttons needs.
*/
const hoverOnly = (markup.match(/group-hover:opacity-100/g) ?? []).length
const keyboardToo = (markup.match(/group-focus-within:opacity-100/g) ?? []).length
check('every hover-revealed control has a keyboard reveal too',
  hoverOnly > 0 && keyboardToo >= hoverOnly, `${hoverOnly} hover vs ${keyboardToo} focus-within`)
check('no `group-focus-visible` left on a non-focusable row', !markup.includes('group-focus-visible'))

/* ── The quick actions (10-20) ──────────────────────────────────────────── */

console.log('\nQuick actions — derived from the registry, not hand-listed\n')

// Dismiss is on EVERY row, because "not now" always makes sense.
const dismissButtons = (markup.match(/aria-label="Dismiss /g) ?? []).length
check('every row carries a dismiss', dismissButtons === rows.length,
  `${dismissButtons} dismiss buttons for ${rows.length} rows`)
check('the dismiss says how long it lasts', markup.includes(`for ${ATTENTION_DISMISS_DAYS} days`))

// Delete is on exactly the kinds whose row can honestly be deleted. Counted
// from the registry rather than written as a number, so adding a fifth kind
// moves both sides of this at once.
const expectedDeletes = rows.filter((r) => attentionDeleteTarget(r.category, r.id)).length
const deleteButtons = (markup.match(/aria-label="Delete /g) ?? []).length
check('delete appears on exactly the deletable kinds', deleteButtons === expectedDeletes,
  `${deleteButtons} delete buttons, expected ${expectedDeletes}`)
check('there are some of each, so neither half passes vacuously',
  expectedDeletes > 0 && expectedDeletes < rows.length,
  `${expectedDeletes} of ${rows.length} deletable`)

// The delete label NAMES the thing, so "Delete" is never ambiguous on a terse
// row. ⚠ The quote is `&quot;` in the markup — an aria-label is an attribute,
// so React escapes it. Matching on a literal `"` reported a false failure.
check('a delete names its noun',
  markup.includes('Delete lead &quot;') && markup.includes('Delete task &quot;'))

/*
  ⚠ NO BUTTON INSIDE AN ANCHOR. This is the bug the row was restructured to
  avoid: browsers resolve the invalid nesting by firing BOTH, so the first
  Delete press would have navigated away mid-request. `tsc` and the build see
  nothing wrong with it and it renders perfectly.
*/
const anchors = markup.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? []
check('no <button> nested inside an <a>', anchors.every((a) => !a.includes('<button')),
  `${anchors.filter((a) => a.includes('<button')).length} anchors contain a button`)
check('each row still has exactly one real link',
  anchors.length === rows.length, `${anchors.length} anchors for ${rows.length} rows`)
check('the link stretches over the row', markup.includes('after:absolute after:inset-0'))

/*
  ⚠ THE 44px TAP TARGET IS WRITTEN ABSOLUTELY. §12: a density token moves
  HEIGHTS, and `size-11` is `calc(var(--spacing) * 11)` — exactly 44px at the
  default and 38.7px once the 10-17 redraw tightened spacing, which took 66 tap
  targets below the floor in 32 files with nothing reporting it.
*/
check('tap targets are absolute, not spacing-derived', markup.includes('size-[2.75rem]'))
check('no spacing-derived tap target snuck in', !/\bsize-11\b/.test(markup))

// A row mid-write cannot be pressed twice.
const busyMarkup = renderToStaticMarkup(
  React.createElement(AttentionList, { ...props, items: rows, busy: new Set([rows[0].id]) })
)
check('a row with a write in flight is disabled', busyMarkup.includes('disabled=""'))
check('and it says so visually', busyMarkup.includes('animate-spin'))

/* ── The dismissed view ─────────────────────────────────────────────────── */

console.log('\nDismissed view — the undo, which is the only one there is\n')

const quiet: DismissedRow[] = [
  {
    item_key: `milestone-${UUID}`,
    category: 'approaching_milestone',
    title: 'Steelton PSA closing',
    project_name: 'Steelton — Cleveland-Cliffs (PA)',
    dismissed_until: '2026-11-03',
    dismissed_by: 'Eric',
  },
  // A lead has no project, which is the shape that breaks a project-name row.
  {
    item_key: `lead-${UUID}`,
    category: 'lead_review',
    title: 'ITB — Ogden Transit Center',
    project_name: null,
    dismissed_until: '2026-11-03',
    dismissed_by: null,
  },
]

const quietMarkup = renderToStaticMarkup(
  React.createElement(AttentionList, { ...props, items: rows, dismissed: quiet, view: 'dismissed' })
)
check('both dismissed rows render', quiet.every((d) => quietMarkup.includes(d.title)))
check('each offers a restore', (quietMarkup.match(/Restore/g) ?? []).length === quiet.length)
check('it says when the row comes back', quietMarkup.includes('Back on Nov 3'))
check('it names who dismissed it when it knows', quietMarkup.includes('dismissed by Eric'))
check('and says nothing when it does not', !quietMarkup.includes('dismissed by null'))
check('the tab carries the dismissed count', quietMarkup.includes('Dismissed <span class="tnum ml-1">2<'))

// ⚠ The tabs are hidden entirely when nothing has been dismissed — a tab
// reading "Dismissed 0" is a permanent invitation to an empty screen. The
// dismiss BUTTON is never gated, so there is always a way in (§12: gate for
// reading, put creating where no count can reach it).
check('no Dismissed tab until something is dismissed', !markup.includes('Dismissed <span'))
check('but the tabs appear as soon as there is', quietMarkup.includes('Needs you <span'))

const quietEmpty = renderToStaticMarkup(
  React.createElement(AttentionList, { ...props, items: rows, dismissed: [], view: 'dismissed' })
)
check('an empty dismissed view says so rather than looking broken',
  quietEmpty.includes('Nothing dismissed'))

/* ── The shapes that break a list ───────────────────────────────────────── */

console.log('\nEdge shapes\n')

for (const bad of ['NaN', 'undefined', 'Infinity', '[object Object]', 'href="null"']) {
  check(`no ${bad} in the markup`, !markup.includes(bad))
  check(`no ${bad} in the dismissed view`, !quietMarkup.includes(bad))
}

// Empty state, which is the state it should be in most mornings.
const empty = renderToStaticMarkup(React.createElement(AttentionList, { ...props, items: [] }))
check('empty says you are done, not "no results"', empty.includes('Nothing is falling through'))
check('empty renders no rows and no shortcut legend', !empty.includes('data-row=') && !empty.includes('move'))

// The shortcut legend must STATE the new verbs, not leave them to be discovered.
check('the legend names the dismiss shortcut', markup.includes('dismiss'))
check('the legend names the delete shortcut', markup.includes('delete'))

console.log(failures === 0 ? '\n✓ the list renders and says what it means\n' : `\n✗ ${failures} failed\n`)
process.exitCode = failures === 0 ? 0 : 1
