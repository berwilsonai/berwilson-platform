/**
 * Render the dashboard's Needs Attention rail and assert its numbers.
 *
 * ⚠ A BUILD THAT EXITS 0 HAVING LISTED /dashboard IS NOT EVIDENCE IT ANSWERS
 * (CLAUDE.md §12), and the route is behind auth so a curl gets a 307 and proves
 * only that middleware works. This renders the component directly with the one
 * input shape that caused the bug: lists the PAGE has already sliced to six,
 * passed in beside their true totals.
 *
 * The bug it locks down: the badge summed `.length` of three pre-sliced lists,
 * so each contribution capped at 6 and the card under-reported itself — while
 * the true count sat unused in a prop next to it. A fixture that builds the
 * field directly cannot catch that; the slice has to be in the fixture.
 *
 * Run: npx tsx scripts/verify-attention-rail.tsx
 *
 * ⚠ `.tsx` under tsx, never `.mts` under deploy/register.mjs — see the docblock
 * in verify-mspa-render.tsx for the two failures that causes.
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import NeedsAttention from '../src/components/dashboard/NeedsAttention'

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// 20 review rows, 14 overdue milestones, 9 critical DD — all three arrive
// sliced to 6, which is what the dashboard does.
const review = Array.from({ length: 20 }, (_, i) => ({
  id: `r${i}`,
  reason: 'low_confidence',
  confidence: 0.4,
  project: { name: `Project ${i}`, sector: 'infrastructure' },
}))
const milestones = Array.from({ length: 14 }, (_, i) => ({
  id: `m${i}`,
  label: `Milestone ${i}`,
  target_date: '2026-01-01',
  project_id: `p${i}`,
  project: { name: `Project ${i}` },
}))
const dd = Array.from({ length: 9 }, (_, i) => ({
  id: `d${i}`,
  item: `Diligence item ${i}`,
  severity: 'critical',
  project_id: `p${i}`,
  project: { name: `Project ${i}` },
}))

/* eslint-disable @typescript-eslint/no-explicit-any */
const markup = renderToStaticMarkup(
  React.createElement(NeedsAttention as any, {
    reviewItems: review.slice(0, 6),
    overdueItems: milestones.slice(0, 6),
    ddItems: dd.slice(0, 6),
    reviewCount: review.length,
    overdueCount: milestones.length,
    ddCount: dd.length,
    overdueTasks: [{ id: 't1', title: 'A task', due_date: '2026-01-01', project_id: 'p1', project_name: 'Project 1' }],
    investorFollowUps: [],
    dinoPayments: [],
    leads: [],
    expiringCerts: [],
    mailboxAlert: null,
  })
)
/* eslint-enable @typescript-eslint/no-explicit-any */

console.log('\nNeeds Attention rail — 20 review / 14 milestones / 9 DD, each sliced to 6\n')

// The badge: 14 + 9 + 1 task = 24. NOT 6+6+6+1=19 (the old capped sum), and
// NOT 44 (which would mean the Decide queue got folded back in).
const badge = /rounded px-1\.5 py-0\.5">(\d+)</.exec(markup)?.[1]
check('badge reads the true totals and excludes the review queue', badge === '24', `got ${badge}, expected 24`)
check('badge is not the old capped sum', badge !== '19', `got ${badge}`)
check('badge does not include the 20 review rows', badge !== '44' && badge !== '39', `got ${badge}`)

// Section headers must show totals, not the slice.
check('review section header shows 20, not 6', markup.includes('>20<'))
check('milestones section header shows 14, not 6', markup.includes('>14<'))
check('diligence section header shows 9, not 6', markup.includes('>9<'))

// The overflow indicators the two sections never had.
check('milestones say they are hiding 8', markup.includes('+8 more'))
check('diligence says it is hiding 3', markup.includes('+3 more'))
check('review keeps its +14 more link', markup.includes('+14 more'))

// Only six rows of each are actually drawn.
check('only 6 milestone rows rendered', (markup.match(/Milestone \d+</g) ?? []).length === 6,
  `got ${(markup.match(/Milestone \d+</g) ?? []).length}`)

// Nothing broken reaches the reader.
for (const bad of ['NaN', 'undefined', 'Infinity', '[object Object]']) {
  check(`no ${bad} in the markup`, !markup.includes(bad))
}

console.log(failures === 0 ? '\n✓ rail renders and every number is the true one\n' : `\n✗ ${failures} failed\n`)
process.exitCode = failures === 0 ? 0 : 1
