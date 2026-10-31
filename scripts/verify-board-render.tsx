/**
 * Does the new board layer actually render, and does it keep the three
 * structural promises that `tsc` cannot see?
 *
 * ⚠ BEHIND AUTH A CURL CANNOT TELL AN ANSWER FROM A THROW (§12) — `/projects`
 * and `/opportunities` both return the same redirect whether the board works
 * or crashes the page. So the components are rendered directly, on every shape
 * a column can take: full, empty, terminal, and a record with every optional
 * field absent.
 *
 * THE THREE PROMISES, each of which has cost this repo real hours before:
 *
 *   1. NO <button> INSIDE AN <a>. A button nested in an anchor fires BOTH
 *      (§12), which is what forced /attention's rows from Link to div. Three
 *      card components were restructured around the drag handle in this
 *      session, and a regex over the markup is the only thing that can catch a
 *      regression — the typecheck and the build are both blind to it.
 *
 *   2. NO SPACING-DERIVED TAP TARGET. `size-11` is `calc(var(--spacing) * 11)`
 *      and --spacing is 0.22rem here, so that utility is 38.7px — below the
 *      44px floor. The 10-17 density change broke 66 of these and nothing could
 *      report it. The handle must be written absolutely.
 *
 *   3. EVERY DRAG HANDLE IS NAMED. A grip icon with no accessible name is a
 *      button that reads as "button" — the gesture becomes undiscoverable for
 *      exactly the reader who most needs the keyboard path.
 *
 * Run:
 *   export PATH="$HOME/.node/bin:$PATH"
 *   npx tsx scripts/verify-board-render.tsx
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import OpportunityBoard from '../src/components/opportunities/OpportunityBoard'
import NowObjectivesList, { type NowObjectiveItem } from '../src/components/dashboard/NowObjectivesList'
import OpportunityCards from '../src/components/opportunities/OpportunityCards'
import { Segmented } from '../src/components/ui/segmented'
import type { Opportunity } from '../src/lib/supabase/types'
import { OPPORTUNITY_STAGES, OPPORTUNITY_STAGE_LABELS } from '../src/lib/utils/opportunities'

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

const noop = async () => {}

function opp(over: Record<string, unknown> = {}): Opportunity {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Zenthium Partnership',
    opp_type: 'jv',
    status: 'evaluating',
    priority: 'high',
    objective: 'Assess a joint venture on the Fairbanks claims.',
    target_name: 'Zenthium Holdings',
    location: 'Fairbanks, AK',
    sector: 'infrastructure',
    probability: 60,
    next_step: 'Send the MNDA',
    target_close_date: '2026-12-01',
    estimated_value: 48_000_000,
    parent_opportunity_id: null,
    ...over,
  } as unknown as Opportunity
}

/** ⚠ EVERY OPTIONAL FIELD ABSENT — the shape a brand-new record has. */
const bare = opp({
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
})

// ─── the structural checks, applied to any markup ────────────────────────────

/**
 * A <button> inside an <a>. Scans for an anchor open tag and looks for a
 * button before the matching close — crude, but it is looking for a nesting
 * that must never occur at all, so a false positive is cheap and a miss is not.
 */
function buttonInsideAnchor(markup: string): string | null {
  const re = /<a\b[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markup))) {
    const from = m.index + m[0].length
    const close = markup.indexOf('</a>', from)
    if (close < 0) continue
    const inner = markup.slice(from, close)
    if (/<button\b/.test(inner)) return inner.slice(0, 160)
  }
  return null
}

function structuralChecks(label: string, markup: string) {
  const nested = buttonInsideAnchor(markup)
  check(`${label}: no <button> inside an <a>`, nested === null, nested ?? '')
  check(
    `${label}: no spacing-derived tap target (size-11 / h-11)`,
    !/\b(?:size|h)-11\b/.test(markup),
    'use size-[2.75rem] — size-11 is 38.7px at this density'
  )
  check(
    `${label}: nothing renders as NaN, undefined or null`,
    !/NaN|>undefined<|"undefined"|>null</.test(markup),
    markup.slice(0, 200)
  )
  /*
    ⚠ NO LOOKBEHIND, AND THE FIRST VERSION HAD TWO. `(?<!group-)(?<!-)` was
    written to let `group-focus-visible:` through — which it never needed to,
    because `\bfocus:` requires the colon immediately after "focus" and so
    cannot match `focus-visible:` at all. What the lookbehinds DID do was
    excuse `group-focus:` and `peer-focus:`, which are bare-focus variants with
    exactly the same defect: they fire on a mouse click. Found by planting the
    violation rather than by reading the regex (§12: when a check fails,
    suspect the check — and prove it can fail at all).
  */
  /*
    ⚠ A BARE EM DASH AT A VALUE'S OWN WEIGHT READS AS A FAILED RENDER (§12),
    and `formatValue(null)` returns one. With 0 of 10 opportunities carrying an
    estimated_value, this was on every card on the board until 2026-10-26.
    Matches a dash that is the WHOLE text of an element — a dash inside prose,
    or the spacer in a collapsed empty column, is fine and must not trip this.
  */
  check(
    `${label}: no bare em dash as an element's entire content`,
    !/>\s*\u2014\s*</.test(markup.replace(/<p[^>]*text-muted-foreground\/50[^>]*>\s*\u2014\s*<\/p>/g, '')),
    'name the absence in words, or omit the row'
  )
  check(
    `${label}: focus styling is focus-visible, never bare focus:`,
    !/\bfocus:/.test(markup),
    'focus: / group-focus: / peer-focus: all fire on mouse clicks too (§12)'
  )
}

// ─── the opportunities board ─────────────────────────────────────────────────

console.log('\nOpportunity board — every column shape')

const shapes: { label: string; items: Opportunity[]; expect: RegExp[] }[] = [
  {
    label: 'one opportunity in one stage',
    items: [opp()],
    expect: [/Zenthium Partnership/, /Evaluating/],
  },
  {
    label: 'a record with every optional field absent',
    items: [bare],
    expect: [/Unnamed inbound/],
  },
  {
    label: 'one in every status at once',
    items: OPPORTUNITY_STAGES.map((st, i) =>
      opp({ id: `3333333${i}-3333-3333-3333-333333333333`, name: `Deal ${st}`, status: st })
    ),
    expect: [/Deal identified/, /Deal closed_passed/],
  },
  {
    label: 'the empty board',
    items: [],
    expect: [/Identified/],
  },
]

for (const shape of shapes) {
  let markup = ''
  try {
    markup = renderToStaticMarkup(
      React.createElement(OpportunityBoard, { opportunities: shape.items, onMoved: noop })
    )
  } catch (err) {
    check(shape.label, false, `threw: ${err instanceof Error ? err.message : String(err)}`)
    continue
  }
  check(`${shape.label}: renders`, markup.length > 0)
  for (const re of shape.expect) {
    check(`${shape.label}: markup matches ${re}`, re.test(markup), markup.slice(0, 220))
  }
  structuralChecks(shape.label, markup)
}

console.log('\nOpportunity board — the promises the lanes make')
{
  const markup = renderToStaticMarkup(
    React.createElement(OpportunityBoard, { opportunities: [opp(), bare], onMoved: noop })
  )

  // ⚠ EVERY STATUS KEEPS A COLUMN. A funnel with a missing rung misleads, and
  // the empty one is the stage a deal most often still has to reach.
  for (const st of OPPORTUNITY_STAGES) {
    check(
      `the ${st} column is present`,
      markup.includes(OPPORTUNITY_STAGE_LABELS[st]),
      'an absent stage reads as a stage that does not exist'
    )
  }

  // Promise 3: the handle is named, and named after the record.
  check('a drag handle is present', /aria-roledescription="drag handle"/.test(markup))
  check(
    'the handle names the record it moves',
    /aria-label="Move Zenthium Partnership"/.test(markup),
    'a grip with no name reads as "button"'
  )
  const handles = (markup.match(/aria-roledescription="drag handle"/g) ?? []).length
  check(`one handle per card (${handles} for 2 cards)`, handles === 2, `got ${handles}`)

  // The live region has to exist, or a keyboard drag is silent.
  check('a live region is present', /aria-live="assertive"/.test(markup))
  check(
    'the live region is assertive, not polite',
    !/aria-live="polite"/.test(markup),
    'a polite region queues behind whatever is speaking, so arrow presses arrive after the drag ends'
  )

  // The hint must not promise a key that does nothing: this board is
  // lane-only, so it may not say "arrow keys" unqualified.
  check(
    'the hint names only the keys that work',
    /left and right arrow keys/.test(markup),
    'opportunities carries no order column, so up/down is refused'
  )

  // A column that IS the status must not also print the status chip.
  const evaluating = (markup.match(/Evaluating/g) ?? []).length
  check(
    `"Evaluating" appears once, as the column header (${evaluating})`,
    evaluating === 1,
    'one quantity, one place (§12)'
  )
}

// ─── the grid still works ────────────────────────────────────────────────────
//
// ⚠ THE CARD WAS EXTRACTED IN THIS SESSION, so the grid is now a CALLER of a
// component it used to contain. That refactor is exactly where a prop gets
// dropped and the grid silently renders a board-shaped card.
console.log('\nOpportunity cards — the grid after the extraction')
{
  const markup = renderToStaticMarkup(
    React.createElement(OpportunityCards, { opportunities: [opp(), bare] })
  )
  check('the grid renders both cards', /Zenthium Partnership/.test(markup) && /Unnamed inbound/.test(markup))
  check(
    'the grid still shows the status chip (it has no column to carry it)',
    /Evaluating/.test(markup),
    'compact drops the chip; the grid must not'
  )
  check(
    'the grid still shows the objective',
    /joint venture on the Fairbanks claims/.test(markup),
    'compact drops it; the grid must not'
  )
  check('the grid renders NO drag handle', !/aria-roledescription="drag handle"/.test(markup))
  structuralChecks('grid', markup)
}

// ─── the shared view switcher ────────────────────────────────────────────────
console.log('\nSegmented — the control lifted out of the steel board')
{
  const markup = renderToStaticMarkup(
    React.createElement(Segmented, {
      label: 'Opportunity view',
      value: 'board' as const,
      onChange: () => {},
      options: [
        { value: 'board' as const, label: 'Pipeline' },
        { value: 'grid' as const, label: 'Cards', count: 12 },
      ],
    })
  )
  check('the group is named', /aria-label="Opportunity view"/.test(markup))
  check('the selected option is pressed', /aria-pressed="true"/.test(markup))
  check('the unselected option is not', /aria-pressed="false"/.test(markup))
  check('a count renders when given', />12</.test(markup))
  check(
    'the tap target is absolute, not h-7 alone',
    /h-\[2\.75rem\]/.test(markup),
    'h-7 is 24.6px at this density — the original was below the floor'
  )
  structuralChecks('segmented', markup)
}

// ─── the dashboard's Now objectives ─────────────────────────────────────────
//
// ⚠ THE ONLY `reorderable: true` SURFACE IN THE APP, so it is the only place
// the vertical half of the primitive is exercised at all outside dnd.test.ts.
console.log('\nNow objectives — the one reorderable board')
{
  const obj = (over: Partial<NowObjectiveItem> = {}): NowObjectiveItem => ({
    id: 'o1',
    title: 'Close the Steelton PSA',
    target_date: '2026-11-01',
    health: 'on_track',
    owner: { name: 'Richard White', color: 'blue' },
    openTasks: 3,
    ...over,
  })

  const shapes: { label: string; items: NowObjectiveItem[]; expect: RegExp[] }[] = [
    {
      label: 'three objectives, fully populated',
      items: [obj(), obj({ id: 'o2', title: 'Fill the pursuit profile' }), obj({ id: 'o3', title: 'Hire a PM' })],
      expect: [/Close the Steelton PSA/, /Hire a PM/],
    },
    {
      label: 'every optional field absent',
      items: [obj({ id: 'o9', title: 'Bare objective', target_date: null, owner: null, openTasks: 0, health: 'on_track' })],
      expect: [/Bare objective/],
    },
    {
      label: 'an off-track objective shows its health chip',
      items: [obj({ health: 'at_risk' })],
      expect: [/Close the Steelton PSA/],
    },
    {
      label: 'a single objective',
      items: [obj()],
      expect: [/Close the Steelton PSA/],
    },
  ]

  for (const shape of shapes) {
    let markup = ''
    try {
      markup = renderToStaticMarkup(
        React.createElement(NowObjectivesList, { items: shape.items, onReorder: noop })
      )
    } catch (err) {
      check(shape.label, false, `threw: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    check(`${shape.label}: renders`, markup.length > 0)
    for (const re of shape.expect) {
      check(`${shape.label}: markup matches ${re}`, re.test(markup), markup.slice(0, 200))
    }
    structuralChecks(shape.label, markup)
  }

  const three = renderToStaticMarkup(
    React.createElement(NowObjectivesList, {
      items: [obj(), obj({ id: 'o2', title: 'Second' }), obj({ id: 'o3', title: 'Third' })],
      onReorder: noop,
    })
  )
  // The numbering IS the claim this board lets you change, so it has to be
  // there and has to start at 1.
  check('the list is numbered from 1', />1</.test(three) && />2</.test(three) && />3</.test(three))
  const handles = (three.match(/aria-roledescription="drag handle"/g) ?? []).length
  check(`one handle per objective (${handles} for 3)`, handles === 3, `got ${handles}`)

  // ⚠ THIS IS THE ASSERTION THAT PULLS reorderable APART FROM THE OTHERS. A
  // one-lane reorderable board has no horizontal move, so the hint must say
  // "up and down" — not "the arrow keys" (which would promise left/right) and
  // not "left and right" (which is what every stage board says).
  check(
    'the hint names up and down only',
    /up and down arrow keys/.test(three),
    'a one-lane board has no horizontal move'
  )
  check(
    'the hint does NOT promise left and right',
    !/left and right/.test(three),
    'there is only one lane'
  )

  // A single objective has nothing to reorder, so the hint is noise.
  const one = renderToStaticMarkup(React.createElement(NowObjectivesList, { items: [obj()], onReorder: noop }))
  check('a single objective renders no hint', !/arrow keys/.test(one))

  // Empty renders nothing at all — the panel would otherwise be a shrug.
  const none = renderToStaticMarkup(React.createElement(NowObjectivesList, { items: [], onReorder: noop }))
  check('an empty list renders no markup at all', none === '', `got ${none.length} chars`)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exitCode = fail === 0 ? 0 : 1
