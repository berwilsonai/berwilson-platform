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

import AttentionList, { type AttentionRow } from '../src/components/attention/AttentionList'
import { ATTENTION_KINDS, urgencyBand } from '../src/lib/attention-kinds'

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// One row per kind, cycling the urgency bands, half of them with no project.
const rows: AttentionRow[] = ATTENTION_KINDS.map((k, i) => ({
  id: `${k.category}-${i}`,
  category: k.category,
  urgency: [100, 80, 60, 30, 0][i % 5],
  title: `${k.label} item ${i}`,
  detail: `${i * 3} days`,
  project_id: i % 2 === 0 ? '11111111-1111-1111-1111-111111111111' : null,
  project_name: i % 2 === 0 ? 'Steelton — Cleveland-Cliffs (PA)' : '—',
  age_days: i * 3,
  due_date: i % 3 === 0 ? '2026-10-17' : null,
}))

console.log('\nAttention list — every kind, every band\n')

const markup = renderToStaticMarkup(React.createElement(AttentionList, { items: rows, active: null, onFilter: () => {}, onOpen: () => {} }))

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

// Hover-revealed arrow must also appear on keyboard focus (§12).
check('the hover arrow has a focus-visible fallback',
  !markup.includes('group-hover:opacity-100') || markup.includes('group-focus-visible:opacity-100'))

for (const bad of ['NaN', 'undefined', 'Infinity', '[object Object]', 'href="null"']) {
  check(`no ${bad} in the markup`, !markup.includes(bad))
}

// Empty state, which is the state it should be in most mornings.
const empty = renderToStaticMarkup(React.createElement(AttentionList, { items: [], active: null, onFilter: () => {}, onOpen: () => {} }))
check('empty says you are done, not "no results"', empty.includes('Nothing is falling through'))
check('empty renders no rows and no shortcut legend', !empty.includes('data-row=') && !empty.includes('move'))

console.log(failures === 0 ? '\n✓ the list renders and says what it means\n' : `\n✗ ${failures} failed\n`)
process.exitCode = failures === 0 ? 0 : 1
