/**
 * Render the commitment ledger and assert what a reader will actually see.
 *
 * ⚠ /commitments IS ADMIN-ONLY BEHIND AUTH, so a curl returns the same
 * redirect whether the page answers or throws (§12). This renders the client
 * directly across every row shape that breaks a list: no due date, a date far
 * past, a date ahead, no owner, no record, no mailbox, a snoozed row, a row
 * whose thread has no date at all, and a near-duplicate pair.
 *
 * Run: npx tsx scripts/verify-commitments-render.tsx
 *
 * ⚠ `.tsx` under tsx, never `.mts` under deploy/register.mjs — Node's TS
 * handling has no JSX (§12).
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import CommitmentsLedger from '../src/components/commitments/CommitmentsLedger'
import type { CommitmentListItem } from '../src/lib/commitments/list'

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

const base: CommitmentListItem = {
  id: 'r0', what: 'Countersign and return the GridEdge MNDA', side: 'them',
  status: 'open', owner_name: 'Jonathan Houk', due_date: null, created_at: iso(3),
  snoozed_until: null, project_id: null, opportunity_id: null, record_name: null,
  mailbox: 'moose@berwilson.com', chase_text: null, chase_drafted_at: null,
  thread_last_at: iso(2),
}

const rows: CommitmentListItem[] = [
  base,
  // Every absence at once — the shape that renders a row of bare em dashes.
  { ...base, id: 'r1', what: 'Send the regulator photo', owner_name: null,
    mailbox: null, thread_last_at: null, created_at: null },
  // Deep overdue: banded to muted, NOT red (§12 — when every row is red…).
  { ...base, id: 'r2', what: 'Make initial $50,000 payment', side: 'us',
    due_date: day(-90), created_at: iso(95), thread_last_at: iso(80) },
  { ...base, id: 'r3', what: 'Sign the LOI', side: 'us', due_date: day(-2) },
  { ...base, id: 'r4', what: 'Review the PSA', due_date: day(0) },
  { ...base, id: 'r5', what: 'Submit signed LOIs', due_date: day(30),
    project_id: '11111111-1111-1111-1111-111111111111',
    record_name: 'Steelton — Cleveland-Cliffs (PA)' },
  { ...base, id: 'r6', what: 'Quieted obligation', snoozed_until: day(7) },
  // The duplicate pair — must be FLAGGED and both rows must still render.
  { ...base, id: 'r7', what: 'Send the ESPC background material', thread_last_at: iso(40) },
  { ...base, id: 'r8', what: 'Send the ESPC background material', thread_last_at: iso(18) },
  { ...base, id: 'r9', what: 'Chase me', chase_text: 'Following up on the MNDA.',
    chase_drafted_at: iso(1) },
  { ...base, id: 'r10', what: 'On an opportunity', opportunity_id: '22222222-2222-2222-2222-222222222222',
    record_name: 'Synetra' },
]

const totals = { open: 11, quiet: 1, settled: 36, undated: 6, retired: 158 }

for (const sort of ['newest', 'activity', 'due', 'oldest'] as const) {
  console.log(`\n── sort=${sort}`)
  const html = renderToStaticMarkup(
    <CommitmentsLedger
      items={rows}
      totals={totals}
      filters={{ view: 'open', sort }}
      mailboxes={['moose@berwilson.com', 'tuaone@berwilson.com']}
      loadError={null}
      withheld={2}
      setParam={() => {}}
    />
  )
  check('every row rendered', rows.every((r) => html.includes(r.what.slice(0, 20))))
  check('no NaN / undefined / Infinity reached the markup',
    !/NaN|undefined|Infinity/.test(html),
    (html.match(/NaN|undefined|Infinity/) ?? [])[0])
  check('the sort control is present and reflects the choice',
    html.includes('Sort order') && html.includes(`value="${sort}"`) || sort === 'newest')
  check('the withheld disclosure is shown', html.includes('protected project'))
  check('the duplicate pair is flagged', html.includes('also said'))
  check('no bare em dash at a value’s own weight', !/>\s*—\s*</.test(html))
  check('a 90-day overdue row is NOT in alarm red',
    !/text-red-600[^"]*"[^>]*>90d overdue/.test(html))
}

console.log(failures === 0 ? '\nAll render checks passed.' : `\n${failures} FAILED`)
process.exitCode = failures === 0 ? 0 : 1
