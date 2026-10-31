/**
 * Does the Pursuit Snapshot rail still render, and are the three removed
 * fields actually gone from the markup?
 *
 * Richard asked twice to be rid of Decision, NTP and Substantial Completion.
 * The first pass read it as "make them easier to set" and rendered all four
 * key dates unconditionally, so the check that matters is not "does it
 * compile" but "does the string reach a reader".
 *
 * ⚠ BEHIND AUTH A CURL CANNOT TELL AN ANSWER FROM A THROW (§12): /projects/[id]
 * returns the same redirect whether this rail renders or crashes. So the
 * component is rendered directly, over three shapes — a full project, one with
 * nothing set (the shape that tempted the first pass into rendering empty
 * rows), and a closed one, where `isOpen` takes its other branch.
 *
 * Run:
 *   export PATH="$HOME/.node/bin:$PATH"
 *   npx tsx --import ./deploy/register.mjs scripts/verify-snapshot-render.tsx
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PursuitSnapshot from '../src/components/projects/PursuitSnapshot'
// InlineField calls useRouter, so the rail needs an app-router context to
// render at all. A stub is enough — nothing here navigates.
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'

const stubRouter = {
  push: () => {}, replace: () => {}, refresh: () => {},
  back: () => {}, forward: () => {}, prefetch: () => {},
} as never

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ✓ ' + msg) }
  else { fail++; console.log('  ✗ ' + msg) }
}

const base = {
  id: 'p1', name: 'Steelton', sector: 'infrastructure', stage: 'in_discussions',
  status: 'active', estimated_value: 12_000_000_000, win_probability: 80,
  capture_lead: 'Richard', bid_due_date: '2026-11-12', award_date: null,
  confidential: false, parent_project_id: null, location: 'UT', description: null,
} as never

for (const [label, shape] of [
  ['full', base],
  ['nothing set', { ...(base as object), win_probability: null, estimated_value: null, capture_lead: null, bid_due_date: null } as never],
  ['won', { ...(base as object), stage: 'won' } as never],
] as const) {
  const html = renderToStaticMarkup(
    React.createElement(
      AppRouterContext.Provider,
      { value: stubRouter },
      React.createElement(PursuitSnapshot, { project: shape })
    )
  )
  console.log(`\n${label}:`)
  for (const banned of ['NTP', 'Substantial Completion', 'Decision', 'No-Bid', 'Go / No-Go'])
    ok(!html.includes(banned), `no "${banned}" in the markup`)
  for (const bad of ['NaN', 'undefined', 'Infinity', '[object Object]'])
    ok(!html.includes(bad), `no "${bad}"`)
  ok(html.includes('Win Probability'), 'Win Probability still renders')
  ok(html.includes('Key Dates'), 'Key Dates card still renders')
  ok(html.includes('Award'), 'Award row still renders')
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
