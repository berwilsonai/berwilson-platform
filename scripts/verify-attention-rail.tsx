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
 * ⚠ `.tsx` under tsx, never `.mts` under deploy/register.mjs. That loader does
 * not compile JSX, and `next/server` / `next/headers` do not resolve under it
 * at all — so a top-level import of either poisons the whole module (§12).
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

/*
  ⚠ EVERY TRUNCATING SECTION MUST OFFER A WAY TO THE REST, AND IT MUST BE A
  LINK. Six of the eight sections used to cut off at six items in silence; two
  of them (milestones, diligence) then got the COUNT in plain text, because
  there is no cross-portfolio page for either and /attention did not exist yet.
  Naming a number a reader cannot reach is only half a fix.
*/
const overflows = [...markup.matchAll(/\+(\d+) more →/g)].map((m) => m[0])
check('every overflow is rendered as an anchor, not text',
  overflows.every((o) => {
    const i = markup.indexOf(o)
    return markup.lastIndexOf('<a', i) > markup.lastIndexOf('<p', i)
  }),
  overflows.join(', '))
check('milestones overflow points at /attention, which is now a route',
  markup.includes('href="/attention?kind=approaching_milestone"'))
check('diligence overflow points at /attention',
  markup.includes('href="/attention?kind=critical_dd"'))
check('the card header is itself a link to the full list',
  markup.includes('href="/attention"'))

// Only six rows of each are actually drawn.
check('only 6 milestone rows rendered', (markup.match(/Milestone \d+</g) ?? []).length === 6,
  `got ${(markup.match(/Milestone \d+</g) ?? []).length}`)

// Nothing broken reaches the reader.
// The three sections that silently truncated now say so too.
const many = Array.from({ length: 9 }, (_, i) => ({ id: `x${i}` }))
check('a section given more than six items always offers the rest',
  (() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const m = renderToStaticMarkup(
      React.createElement(NeedsAttention as any, {
        reviewItems: [], overdueItems: [], ddItems: [],
        reviewCount: 0, overdueCount: 0, ddCount: 0,
        overdueTasks: [],
        investorFollowUps: many.map((r, i) => ({ ...r, name: `Investor ${i}`, stage: 'hot', next_step: 'Call', next_step_date: '2026-10-01' })),
        dinoPayments: [], leads: [], expiringCerts: [], mailboxAlert: null,
      })
    )
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return m.includes('+3 more →') && m.includes('href="/investors"')
  })(),
  'an investor list of 9 should offer the 3 it hides')

for (const bad of ['NaN', 'undefined', 'Infinity', '[object Object]']) {
  check(`no ${bad} in the markup`, !markup.includes(bad))
}

console.log(failures === 0 ? '\n✓ rail renders and every number is the true one\n' : `\n✗ ${failures} failed\n`)
process.exitCode = failures === 0 ? 0 : 1
