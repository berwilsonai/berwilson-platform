/**
 * Does the "Just in" band actually render, for every shape a row can take?
 *
 * ⚠ BEHIND AUTH A CURL CANNOT TELL AN ANSWER FROM A THROW (§12) — `/dashboard`
 * returns the same 307 whether the band works or crashes the page. So the
 * component is rendered directly, on every combination the reader can hit: a
 * recording on a deal, a recording on nothing, a record Pepper created, a row
 * with no date, a row with no detail, and the empty list.
 *
 * Run:
 *   export PATH="$HOME/.node/bin:$PATH"
 *   npx tsx scripts/verify-just-in-render.tsx
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import JustIn from '../src/components/dashboard/JustIn'
import type { JustInItem } from '../src/lib/records/just-in'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function item(over: Partial<JustInItem> = {}): JustInItem {
  return {
    key: 'meeting:1',
    kind: 'recording',
    title: 'Synetra / Ber Wilson Discussion',
    detail: 'A first conversation about working together.',
    on: '2026-10-19',
    placement: null,
    action: { label: 'Attach it to a deal', href: '/intake/meeting/abc' },
    learnedAt: '2026-10-19T17:52:23Z',
    ...over,
  }
}

const shapes: { label: string; items: JustInItem[]; expect: RegExp[] }[] = [
  {
    label: 'a recording on no deal',
    items: [item()],
    expect: [/on no deal yet/, /Attach it to a deal/, /Synetra/],
  },
  {
    label: 'a recording already filed on a project',
    items: [item({ placement: { label: 'Steelton', href: '/projects/x' }, action: { label: 'Confirm the follow-ups', href: '/intake/meeting/abc' } })],
    expect: [/Steelton/, /Confirm the follow-ups/],
  },
  {
    label: 'a record Pepper created',
    items: [
      item({
        key: 'opportunity:2',
        kind: 'record',
        title: 'Synetra',
        action: { label: 'Open the opportunity', href: '/opportunities/2' },
      }),
    ],
    // The provenance chip is the whole point of showing it here.
    expect: [/Pepper created this/, /Open the opportunity/],
  },
  {
    label: 'a row with no date and no detail',
    items: [item({ on: null, detail: null })],
    expect: [/Synetra/],
  },
  {
    label: 'all three kinds at once',
    items: [
      item(),
      item({ key: 'meeting:2', placement: { label: 'Tooele', href: '/projects/t' } }),
      item({ key: 'opportunity:3', kind: 'record', title: 'Firm Power', action: { label: 'Open the opportunity', href: '/opportunities/3' } }),
    ],
    expect: [/on no deal yet/, /Tooele/, /Pepper created this/],
  },
]

console.log('\nJust in — render')
for (const shape of shapes) {
  let markup = ''
  try {
    markup = renderToStaticMarkup(React.createElement(JustIn, { items: shape.items }))
  } catch (err) {
    check(shape.label, false, `threw: ${err instanceof Error ? err.message : String(err)}`)
    continue
  }
  const missing = shape.expect.filter((re) => !re.test(markup))
  check(shape.label, missing.length === 0, missing.map(String).join(', '))
  // §12: a bare em dash reads as a failed render and NaN reads as a number.
  check(
    `  …and nothing renders as NaN, undefined or null`,
    !/NaN|undefined|>null</.test(markup),
    markup.slice(0, 200)
  )
}

console.log('\nThe empty case')
const empty = renderToStaticMarkup(React.createElement(JustIn, { items: [] }))
// ⚠ THE WHOLE REASON THIS BAND EXISTS is that something invisible needed to be
// loud — so when nothing arrived it must render NOTHING, not an empty panel
// with a shrug in it.
check('an empty list renders no markup at all', empty === '', `got ${empty.length} chars`)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exitCode = fail === 0 ? 0 : 1
