/**
 * Does the ramp-up figure actually reach the screen, on every surface and
 * every shape — and does it say the right number?
 *
 * ⚠ BEHIND AUTH A CURL CANNOT TELL AN ANSWER FROM A THROW (§12): /projects
 * returns the same redirect whether the Capacity column renders or crashes the
 * page. So the components are rendered directly, on every shape the figure can
 * take — absent, one phase, undated, and a program rolled up from leaves.
 *
 * ⚠ AND THE SEEDED DATA IS RICHARD'S OWN WORKED EXAMPLE, which is the one case
 * that distinguishes the two readings of the rule: 100 MW + 300 MW must render
 * **400 MW** and never 300. §12 — a worked example whose figures coincide
 * cannot distinguish two readings, and this one does not coincide.
 *
 * WHAT THIS CATCHES THAT `tsc` AND THE UNIT TESTS CANNOT:
 *
 *   1. A FIGURE THAT NEVER RENDERS. `PowerFigure` returns null for an absent
 *      total by design, so a mis-threaded prop is indistinguishable from "this
 *      deal has no schedule" — on every card, silently. The assertions below
 *      demand the number is PRESENT in the markup.
 *
 *   2. `NaN`, `undefined` AND `Infinity` REACHING THE MARKUP. `megawatts`
 *      arrives from PostgREST as a STRING, and one missed parse prints
 *      "NaN MW" at a reader with a green typecheck.
 *
 *   3. A PROGRAM AND ITS SITES DISAGREEING. The table and the card are two
 *      readers of one quantity; both are rendered over the same set here and
 *      asserted to print the same figure.
 *
 * Run:
 *   export PATH="$HOME/.node/bin:$PATH"
 *   npx tsx scripts/verify-power-render.tsx
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { PowerFigure, PowerScheduleNote } from '../src/components/records/PowerFigure'
import ProjectsTable from '../src/components/projects/ProjectsTable'
import ProjectCard from '../src/components/dashboard/ProjectCard'
import OpportunityCards from '../src/components/opportunities/OpportunityCards'
import {
  phaseLookup,
  powerTotal,
  subtreePower,
  type PowerPhase,
} from '../src/lib/records/power'
import type { PhaseRow } from '../src/lib/records/power-read'
import type { Opportunity, Project } from '../src/lib/supabase/types'

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

/** Nothing a reader must never see, on any surface. */
function clean(label: string, html: string) {
  for (const poison of ['NaN', 'undefined', 'Infinity', '[object Object]']) {
    check(`${label}: no "${poison}" in the markup`, !html.includes(poison))
  }
}

const PROGRAM_ID = '11111111-1111-1111-1111-111111111111'
const SITE_A = '22222222-2222-2222-2222-222222222222'
const SITE_B = '33333333-3333-3333-3333-333333333333'
const SOLO = '44444444-4444-4444-4444-444444444444'
const BARE = '55555555-5555-5555-5555-555555555555'

function project(id: string, name: string, over: Record<string, unknown> = {}): Project {
  return {
    id,
    name,
    sector: 'infrastructure',
    status: 'active',
    stage: 'prospecting',
    description: null,
    estimated_value: null,
    contract_type: null,
    delivery_method: null,
    location: null,
    client_entity: null,
    solicitation_number: null,
    award_date: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-10-30T00:00:00Z',
    parent_project_id: null,
    applicable_standards: [],
    bid_due_date: null,
    win_probability: null,
    capture_lead: null,
    incumbent: null,
    competitors: [],
    win_strategy: null,
    latitude: null,
    longitude: null,
    map_icon: null,
    map_geometry: null,
    drive_folder_id: null,
    drive_folder_url: null,
    deal_folder_id: null,
    drive_source_folder_id: null,
    drive_source_folder_url: null,
    match_aliases: [],
    confidential: false,
    auto_created_from: null,
    data_room_template: 'data_center',
    ...over,
  } as unknown as Project
}

/*
  ⚠ MEGAWATTS AS A **STRING** ON PURPOSE. PostgREST hands a `numeric` column
  back as a string, so this is the real shape, and the version of the arithmetic
  that assumed `number` would concatenate "100" and "300" into "100300". A
  fixture that builds the field the way the producer never does cannot catch a
  producer that never fills it (§12).
*/
const PHASES: PhaseRow[] = [
  { id: 'p1', project_id: SITE_A, opportunity_id: null, phase_no: 1, megawatts: '100.00', target_date: '2027-06-01', label: 'Phase 1' },
  { id: 'p2', project_id: SITE_A, opportunity_id: null, phase_no: 2, megawatts: '300.00', target_date: '2029-08-01', label: 'Phase 2' },
  { id: 'p3', project_id: SITE_B, opportunity_id: null, phase_no: 1, megawatts: '250.50', target_date: null, label: null },
  { id: 'p4', project_id: SOLO, opportunity_id: null, phase_no: 1, megawatts: '1200', target_date: '2028-03-15', label: null },
]

const SET = [
  project(PROGRAM_ID, 'Steelton Program'),
  project(SITE_A, 'Steelton Site A', { parent_project_id: PROGRAM_ID }),
  project(SITE_B, 'Steelton Site B', { parent_project_id: PROGRAM_ID }),
  project(SOLO, 'Eagle Mountain'),
  project(BARE, 'Unscheduled Deal'),
]
const lookup = phaseLookup(PHASES)

console.log('\nPowerFigure — every variant × every shape')
{
  const cases: Array<[string, PowerPhase[]]> = [
    ['absent', []],
    ["Richard's example", [{ phase_no: 1, megawatts: '100', target_date: '2027-06-01' }, { phase_no: 2, megawatts: '300', target_date: '2029-08-01' }]],
    ['undated', [{ phase_no: 1, megawatts: '250.5', target_date: null }]],
    ['four figures', [{ phase_no: 1, megawatts: '1200', target_date: '2028-03-15' }]],
  ]
  for (const [name, phases] of cases) {
    for (const variant of ['inline', 'column', 'metric'] as const) {
      const html = renderToStaticMarkup(
        <PowerFigure total={powerTotal(phases)} variant={variant} />
      )
      clean(`${variant}/${name}`, html)
    }
  }

  // The worked example, in the variant a card uses.
  const example = powerTotal([
    { phase_no: 1, megawatts: '100', target_date: '2027-06-01' },
    { phase_no: 2, megawatts: '300', target_date: '2029-08-01' },
  ])
  const inline = renderToStaticMarkup(<PowerFigure total={example} />)
  check('inline prints "400 MW" — the increment reading', inline.includes('400 MW'), inline)
  check('inline does NOT print "300 MW" — the cumulative misreading', !inline.includes('300 MW'))

  // Absence renders nothing inline, and a muted dash in a column.
  check(
    'inline renders NOTHING when there is no schedule',
    renderToStaticMarkup(<PowerFigure total={powerTotal([])} />) === ''
  )
  const col = renderToStaticMarkup(<PowerFigure total={powerTotal([])} variant="column" />)
  check('column renders a muted dash with an accessible label', col.includes('—') && col.includes('aria-label'), col)

  // Thousands separated, never GW.
  const big = renderToStaticMarkup(<PowerFigure total={powerTotal([{ phase_no: 1, megawatts: '1200' }])} />)
  check('1,200 MW is separated and NOT abbreviated to GW', big.includes('1,200 MW') && !big.includes('GW'), big)

  const note = renderToStaticMarkup(<PowerScheduleNote total={example} />)
  check('the schedule note names when it is fully ramped', note.includes('Aug 2029'), note)
  const undated = renderToStaticMarkup(
    <PowerScheduleNote total={powerTotal([{ phase_no: 1, megawatts: '250.5', target_date: null }])} />
  )
  check('an undated schedule says so in WORDS, not a dash', undated.includes('no dates set'), undated)
  clean('schedule note', note + undated)
}

console.log('\nThe program and its sites must agree — table vs card')
{
  const programPower = subtreePower(SET[0], SET, lookup)
  // 100 + 300 + 250.5 = 650.5 across the two leaves; the program's own is none.
  check('the program rolls up to 650.5 MW from its two sites', programPower.megawatts === 650.5, String(programPower.megawatts))
  check('and it says it is rolled', programPower.rolled === true)

  const table = renderToStaticMarkup(
    <ProjectsTable projects={SET} allProjects={SET} phases={PHASES} />
  )
  clean('ProjectsTable', table)
  check('the table has a Capacity column', table.includes('Capacity'))
  check('the table prints the program\'s rolled 650.5 MW', table.includes('650.5 MW'), '')
  check('the table prints Site A\'s own 400 MW', table.includes('400 MW'))
  check('the table prints 1,200 MW for the standalone', table.includes('1,200 MW'))
  check('the table marks the rolled figure as rolled', table.includes('rolled'))

  const card = renderToStaticMarkup(
    <ProjectCard project={SET[0]} power={programPower} isProgram />
  )
  clean('ProjectCard', card)
  check('the card prints the SAME 650.5 MW the table does', card.includes('650.5 MW'), '')

  // A card for the deal with no schedule must look exactly as it did before.
  const bare = renderToStaticMarkup(
    <ProjectCard project={SET[4]} power={subtreePower(SET[4], SET, lookup)} />
  )
  clean('ProjectCard (unscheduled)', bare)
  check('an unscheduled card prints no megawatt figure at all', !bare.includes('MW'), '')
}

console.log('\nOpportunity cards — the other half of the shared child')
{
  const oppPhases: PhaseRow[] = [
    { id: 'o1', project_id: null, opportunity_id: 'aaaa', phase_no: 1, megawatts: '75.5', target_date: '2027-01-01', label: null },
  ]
  const oppLookup = phaseLookup(oppPhases)
  const opportunity = {
    id: 'aaaa',
    name: 'GridEdge',
    opp_type: 'partnership',
    status: 'active',
    stage: 'prospecting',
    priority: null,
    description: null,
    objective: null,
    thesis: null,
    target_name: null,
    counterparty: null,
    sector: null,
    location: null,
    website: null,
    source: null,
    estimated_value: null,
    deal_structure: null,
    ownership_stake: null,
    probability: null,
    lead: null,
    identified_date: null,
    target_close_date: null,
    next_step: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-10-30T00:00:00Z',
    drive_folder_id: null,
    drive_folder_url: null,
    match_aliases: [],
    drive_source_folder_id: null,
    drive_source_folder_url: null,
    auto_created_from: null,
    data_room_template: 'standard',
  } as unknown as Opportunity

  const html = renderToStaticMarkup(
    <OpportunityCards
      opportunities={[opportunity]}
      powerOf={(id) => powerTotal(oppLookup(id))}
    />
  )
  clean('OpportunityCards', html)
  // ⚠ THE ASSERTION THAT MATTERS: `project_id` is NULL on this row, and the
  // version of `phaseLookup` that keyed on it alone dropped every opportunity
  // phase silently — the whole opportunity half of the pipeline, invisible.
  check('an OPPORTUNITY phase reaches the card (project_id is null)', html.includes('75.5 MW'), '')
}


/*
  ── THE EDITOR'S POPULATED STATE ───────────────────────────────────────────
  ⚠ THE ONE SURFACE A SCREENSHOT COULD NOT REACH. `PowerRamp` calls
  `useRouter`, which throws outside a Next request, and seeding the production
  database to photograph it is not an option — so the populated table, the one
  place the increment/cumulative distinction is actually SHOWN to the person
  typing, would have shipped rendered by nobody. Mounting the router context
  by hand is the cheapest way to see it (§12: a listed route is not an
  answering one; exercise the render directly, for every input shape).
*/
import PowerRamp, { type PowerPhaseRow } from '../src/components/records/PowerRamp'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'

console.log('\nPowerRamp — the editor, populated')
{
  const router = {
    push: () => {}, replace: () => {}, refresh: () => {},
    back: () => {}, forward: () => {}, prefetch: () => {},
  }
  const rows: PowerPhaseRow[] = [
    { id: 'r1', phase_no: 1, megawatts: '100.00', target_date: '2027-06-01', label: 'Phase 1' },
    { id: 'r2', phase_no: 2, megawatts: '300.00', target_date: '2029-08-01', label: 'Phase 2' },
  ]
  const html = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <AppRouterContext.Provider value={router as any}>
      <PowerRamp kind="project" recordId={PROGRAM_ID} phases={rows} />
    </AppRouterContext.Provider>
  )
  clean('PowerRamp (populated)', html)
  check('the editor shows the 400 MW total', html.includes('400 MW'), '')
  // ⚠ THE ASSERTION THE WHOLE LAYOUT EXISTS FOR: the running total beside the
  // rows is what makes the increment reading visible as somebody types.
  check('the cumulative column shows 100 MW then 400 MW', html.includes('100 MW') && html.includes('400 MW'))
  check('both dates are offered', html.includes('2027') && html.includes('2029'))
  check('every capacity input is labelled for a screen reader', (html.match(/capacity in megawatts/g) ?? []).length === 2)
  check('the remove button is named per phase', html.includes('Remove phase 1') && html.includes('Remove phase 2'))

  const empty = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <AppRouterContext.Provider value={router as any}>
      <PowerRamp kind="opportunity" recordId="aaaa" phases={[]} />
    </AppRouterContext.Provider>
  )
  clean('PowerRamp (empty)', empty)
  check('the empty editor still offers Add phase', empty.includes('Add phase'))
  // ⚠ THE BUG THE SCREENSHOT FOUND: a bare em dash at the metric's own weight
  // read as a strikethrough. There must be no figure at all until there is one.
  check('the empty editor prints NO em dash at metric weight', !empty.includes('text-metric'), '')
  check('the empty editor says what to do in words', empty.includes('No phases yet'))

  // Six is the ceiling, and the button must say so rather than fail at the API.
  const full = renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <AppRouterContext.Provider value={router as any}>
      <PowerRamp
        kind="project"
        recordId={PROGRAM_ID}
        phases={[1, 2, 3, 4, 5, 6].map((n) => ({ id: `f${n}`, phase_no: n, megawatts: '50', target_date: null, label: null }))}
      />
    </AppRouterContext.Provider>
  )
  clean('PowerRamp (six phases)', full)
  check('six phases total 300 MW', full.includes('300 MW'))
  check('a seventh is refused in words, not at the API', full.includes('at most 6 phases'), '')
  check('and the Add button is disabled', full.includes('disabled'))
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exitCode = fail > 0 ? 1 : 0
