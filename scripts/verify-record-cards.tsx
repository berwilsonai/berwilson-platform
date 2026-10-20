/**
 * Render the opportunity and investor grids and assert what a reader sees.
 *
 * ⚠ BOTH LISTS ARE BEHIND AUTH, SO A CURL RETURNS THE SAME 307 WHETHER THEY
 * ANSWER OR THROW (§12). This renders the two card grids directly, with the
 * shapes that break a card: every optional field absent, every one present, a
 * null value, a zero value, and a non-admin who must see no delete at all.
 *
 * The structural half is the reason it exists. Both grids used to BE the
 * `<Link>`; adding a row delete made the card a wrapper around one, because a
 * `<button>` inside an `<a>` is invalid HTML and browsers fire both — the first
 * press would have navigated away mid-request, with `tsc`, the build and a
 * glance all clean. Nothing but a render check can see that.
 *
 * Run: npx tsx scripts/verify-record-cards.tsx
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import OpportunityCards from '../src/components/opportunities/OpportunityCards'
import InvestorCards, { type InvestorCardData } from '../src/components/investors/InvestorCards'
import type { Investor, Opportunity } from '../src/lib/supabase/types'

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const noop = () => {}

/* ── Opportunities ─────────────────────────────────────────────────────────── */

/** Everything filled in — the card at its most crowded. */
const full = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Zenthium Partnership',
  opp_type: 'partnership',
  status: 'negotiating',
  priority: 'high',
  objective: 'Secure a JV on the Weirton rail spur',
  target_name: 'Zenthium Holdings LLC',
  location: 'Weirton, WV',
  sector: 'infrastructure',
  probability: 65,
  next_step: 'Counter their fee schedule',
  target_close_date: '2026-12-01',
  estimated_value: 48_000_000,
  economics_capture_value: null,
  economics_status: null,
} as unknown as Opportunity

/** ⚠ EVERY OPTIONAL FIELD ABSENT, WHICH IS THE SHAPE A NEW RECORD HAS. */
const bare = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Unnamed inbound',
  opp_type: null,
  status: null,
  priority: null,
  objective: null,
  target_name: null,
  location: null,
  sector: null,
  probability: null,
  next_step: null,
  target_close_date: null,
  estimated_value: null,
  economics_capture_value: null,
  economics_status: null,
} as unknown as Opportunity

/** A zero value — distinct from null, and the one a `||` would hide. */
const zero = { ...full, id: '33333333-3333-3333-3333-333333333333', name: 'Priced at nothing', estimated_value: 0, probability: 0 } as Opportunity

const opps = [full, bare, zero]

console.log('\nOpportunity cards\n')

const oppMarkup = renderToStaticMarkup(
  React.createElement(OpportunityCards, { opportunities: opps, canDelete: true, onDeleted: noop })
)

check('every opportunity renders its name', opps.every((o) => oppMarkup.includes(o.name)))
check('a delete appears on each card',
  (oppMarkup.match(/aria-label="Delete opportunity /g) ?? []).length === opps.length,
  `${(oppMarkup.match(/aria-label="Delete opportunity /g) ?? []).length} of ${opps.length}`)
check('the delete names the record, so a grid of cards is unambiguous',
  oppMarkup.includes('Delete opportunity &quot;Zenthium Partnership&quot;'))

/*
  ⚠ THE STRUCTURAL ASSERTION. A button nested in an anchor fires both.
*/
const oppAnchors = oppMarkup.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? []
check('no <button> nested inside an <a>', oppAnchors.every((a) => !a.includes('<button')),
  `${oppAnchors.filter((a) => a.includes('<button')).length} anchors contain a button`)
check('each card still has exactly one link', oppAnchors.length === opps.length,
  `${oppAnchors.length} anchors for ${opps.length} cards`)
check('the card is a positioned wrapper the button can sit in',
  (oppMarkup.match(/relative group\/card/g) ?? []).length === opps.length)

/* ── Investors ─────────────────────────────────────────────────────────────── */

const investorRow = (over: Partial<Investor> & { id: string; name: string }): Investor =>
  ({
    investor_type: 'family_office',
    stage: 'soft_committed',
    interest_level: 'hot',
    check_size_min: 5_000_000,
    check_size_max: 25_000_000,
    next_step: 'Send the Steelton model',
    next_step_date: '2026-10-01',
    last_contact_date: '2026-09-20',
    ...over,
  }) as unknown as Investor

const investors: InvestorCardData[] = [
  {
    investor: investorRow({ id: '44444444-4444-4444-4444-444444444444', name: 'D.A. Davidson' }),
    indicated: 10_000_000, committed: 5_000_000, funded: 0,
    targets: ['Ber Wilson (parent)', 'Steelton LandCo', 'Delta Energy LLC', 'Myton Rail'],
    isOrganization: true,
  },
  // ⚠ NOTHING COMMITTED AND NO NEXT STEP — the card's own empty state, and the
  // branch where `money` is null.
  {
    investor: investorRow({
      id: '55555555-5555-5555-5555-555555555555', name: 'A private individual',
      check_size_min: null, check_size_max: null, next_step: null, next_step_date: null,
      interest_level: null, stage: null, investor_type: null,
    }),
    indicated: 0, committed: 0, funded: 0, targets: [], isOrganization: false,
  },
]

console.log('\nInvestor cards\n')

const invMarkup = renderToStaticMarkup(
  React.createElement(InvestorCards, { items: investors, canDelete: true, onDeleted: noop })
)

check('every investor renders their name', investors.every((i) => invMarkup.includes(i.investor.name)))
check('a delete appears on each card',
  (invMarkup.match(/aria-label="Delete investor /g) ?? []).length === investors.length)
check('an investor with no commitments says so rather than printing 0',
  invMarkup.includes('No commitments yet'))
check('the targets overflow is counted, not truncated silently', invMarkup.includes('+1 more'))

const invAnchors = invMarkup.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? []
check('no <button> nested inside an <a>', invAnchors.every((a) => !a.includes('<button')))
check('each card still has exactly one link', invAnchors.length === investors.length)

/* ── The gate, and the shapes that break a list ───────────────────────────── */

console.log('\nThe admin gate, and edge shapes\n')

/*
  ⚠ BOTH ROUTES ARE ADMIN-ONLY, SO A NON-ADMIN MUST GET NO BUTTON — not a
  button that answers 403. §12: null renders no button at all rather than a
  dead one. Asserted on BOTH grids, because the flag is passed twice and a
  default of `true` in either would be invisible.
*/
for (const [name, el] of [
  ['opportunities', React.createElement(OpportunityCards, { opportunities: opps, canDelete: false, onDeleted: noop })],
  ['investors', React.createElement(InvestorCards, { items: investors, canDelete: false, onDeleted: noop })],
] as const) {
  const m = renderToStaticMarkup(el)
  check(`${name}: a non-admin sees no delete`, !m.includes('aria-label="Delete'))
  check(`${name}: and still sees every card`, (m.match(/<a\b/g) ?? []).length > 0)
}

// ⚠ AND THE DEFAULT IS CLOSED. Omitting `canDelete` must not grant it: the
// prop is optional so a future call site that forgets it gets the safe answer
// (§12 — make the parameter explicit so a job that forgets gets the SAFE
// behaviour).
const oppDefault = renderToStaticMarkup(
  React.createElement(OpportunityCards, { opportunities: opps, onDeleted: noop })
)
check('omitting canDelete renders no delete — the default is CLOSED',
  !oppDefault.includes('aria-label="Delete'))

// And with no handler there is nothing to call, so no button either.
const oppNoHandler = renderToStaticMarkup(
  React.createElement(OpportunityCards, { opportunities: opps, canDelete: true })
)
check('no onDeleted means no button rather than a dead one',
  !oppNoHandler.includes('aria-label="Delete'))

check('tap targets are absolute, not spacing-derived', oppMarkup.includes('size-[2.75rem]'))
check('no spacing-derived tap target snuck in', !/\bsize-11\b/.test(oppMarkup))
check('the hover reveal has a keyboard fallback',
  oppMarkup.includes('sm:group-focus-within/card:opacity-100'))

for (const [name, m] of [['opportunities', oppMarkup], ['investors', invMarkup]] as const) {
  for (const bad of ['NaN', 'undefined', 'Infinity', '[object Object]', 'href="null"', '>null<']) {
    check(`${name}: no ${bad}`, !m.includes(bad))
  }
}

const emptyOpp = renderToStaticMarkup(React.createElement(OpportunityCards, { opportunities: [], canDelete: true, onDeleted: noop }))
const emptyInv = renderToStaticMarkup(React.createElement(InvestorCards, { items: [], canDelete: true, onDeleted: noop }))
check('an empty opportunity grid renders no card', !emptyOpp.includes('<a'))
check('an empty investor grid renders no card', !emptyInv.includes('<a'))

console.log(failures === 0 ? '\n✓ both grids render, and the delete is where it belongs\n' : `\n✗ ${failures} failed\n`)
process.exitCode = failures === 0 ? 0 : 1
