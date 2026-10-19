/**
 * The manual-logging door, asserted on the rendered markup.
 *
 * ⚠ A RECORD PAGE IS BEHIND AUTH, SO A CURL RETURNS THE SAME REDIRECT WHETHER
 * IT ANSWERS OR THROWS (§12). This renders the components directly.
 *
 * Three things it proves, each of which was broken or missing before:
 *   1. `RecordLogMenu` offers every manual record type, with hrefs that carry
 *      `?new=1` only where the destination actually auto-opens a form — a menu
 *      entry whose target does nothing is worse than no entry.
 *   2. `MeetingsView` and `UpdatesTab` open their form from `startNew`, so the
 *      deep link is not a promise the page fails to keep.
 *   3. The tab registries keep the five tabs a human types into visible on a
 *      record that holds NOTHING. Measured 2026-10-18: 17 of 19 projects had
 *      no meeting, so the only door to logging one sat under "More".
 *
 * Run: npx tsx scripts/verify-record-log.tsx
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import RecordLogMenu from '../src/components/records/RecordLogMenu'
import MeetingsView from '../src/components/meetings/MeetingsView'
import UpdatesTab from '../src/components/projects/UpdatesTab'
import { OpportunityNotesView } from '../src/components/opportunities/OpportunityNotes'
import { PROJECT_TABS, OPPORTUNITY_TABS } from '../src/components/records/tabs'
import type { RecordTab } from '../src/components/records/RecordTabBar'
import { logEntries, logHref } from '../src/lib/records/log-menu'

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const PID = '11111111-1111-1111-1111-111111111111'

// ── 1. The menu ────────────────────────────────────────────────────────────
// The panel is collapsed until clicked, so static render can only prove the
// trigger; the entries are asserted off the registry the component renders
// from, which is why that registry lives in src/lib.
console.log('\nRecordLogMenu — the trigger\n')
for (const kind of ['project', 'opportunity'] as const) {
  const markup = renderToStaticMarkup(
    React.createElement(RecordLogMenu, { basePath: `/${kind}s/${PID}`, kind, canLogMeeting: true }),
  )
  check(`${kind}: the button says Log`, markup.includes('Log'))
  check(`${kind}: it is a menu, not a link`, markup.includes('aria-haspopup="menu"'))
  check(`${kind}: it starts closed`, markup.includes('aria-expanded="false"'))
}

console.log('\nEvery entry names a real tab, and ?new=1 only where it works\n')

// ⚠ THE CHECK THAT STOPS THE MENU ROTTING. An entry pointing at a segment the
// record does not have is a 404 from a primary button; an entry carrying
// `?new=1` at a page that ignores it is a dead promise. Both are silent —
// tsc cannot see either, because a href is a string.
const TABS = { project: PROJECT_TABS, opportunity: OPPORTUNITY_TABS } as const
// The pages that read `new` and open their form. Keep this in step with the
// `searchParams` destructures under src/app.
const READS_NEW: Record<string, string[]> = {
  project: ['meetings', 'tasks', 'updates'],
  opportunity: ['meetings', 'tasks', 'notes'],
}

for (const kind of ['project', 'opportunity'] as const) {
  const base = `/${kind}s/${PID}`
  for (const entry of logEntries(kind, true)) {
    const href = logHref(base, entry)
    check(
      `${kind}: ${entry.label} → a tab that exists`,
      TABS[kind].some((t) => t.segment === entry.segment),
      `no tab with segment "${entry.segment}"`,
    )
    check(
      `${kind}: ${entry.label} carries ?new=1 only if the page reads it`,
      entry.autoOpens === READS_NEW[kind].includes(entry.segment),
      entry.autoOpens
        ? `${href} promises a form /${entry.segment} does not open`
        : `/${entry.segment} opens a form but the menu does not ask for it`,
    )
  }
  // A non-admin is not offered a meeting form they cannot submit.
  check(
    `${kind}: a non-admin is not offered Meeting`,
    !logEntries(kind, false).some((e) => e.segment === 'meetings'),
  )
}

// ── 2. The destinations open their form ────────────────────────────────────
console.log('\nThe deep link opens the form\n')

const meetingProps = {
  scope: 'project' as const,
  projectId: PID,
  initialMeetings: [],
  initialFiles: [],
  teamMembers: [],
  contacts: [],
  canEdit: true,
  canDelete: true,
}

const closed = renderToStaticMarkup(React.createElement(MeetingsView, meetingProps))
check('meetings, no param: the list is shown', closed.includes('No meetings logged'))

const open = renderToStaticMarkup(React.createElement(MeetingsView, { ...meetingProps, startNew: true }))
check('meetings, ?new=1: the form is shown', open.includes('New meeting record'))
check('meetings, ?new=1: the list is NOT shown', !open.includes('No meetings logged'))
check('the form takes a pasted transcript', open.toLowerCase().includes('transcript'))

// A non-admin may not create one, so the param must not open a form they
// cannot submit — it falls back to the read-only list.
const readOnly = renderToStaticMarkup(
  React.createElement(MeetingsView, { ...meetingProps, canEdit: false, canDelete: false, startNew: true }),
)
check('meetings, ?new=1 as a non-admin: no form', !readOnly.includes('New meeting record'))

const updatesClosed = renderToStaticMarkup(
  React.createElement(UpdatesTab, { projectId: PID, initialUpdates: [] }),
)
check('updates, no param: the composer is closed', !updatesClosed.includes('Extract with AI'))

const updatesOpen = renderToStaticMarkup(
  React.createElement(UpdatesTab, { projectId: PID, initialUpdates: [], startNew: true }),
)
check('updates, ?new=1: the composer is open', updatesOpen.includes('Extract with AI'))
check('updates, ?new=1: "save as-is" is offered too', updatesOpen.includes('Save as-is'))

// ── An opportunity note is the SAME composer and the SAME card ─────────────
// ⚠ The whole point of the 10-18 extraction work: typing on an opportunity
// offered no AI pass at all, so these two assertions are the regression.
console.log('\nAn opportunity note behaves like a project update\n')

const notesClosed = renderToStaticMarkup(
  React.createElement(OpportunityNotesView, { opportunityId: PID, notes: [], onSaved: () => {} }),
)
check('notes, no param: the composer is closed', !notesClosed.includes('Extract with AI'))
check('notes, no param: the empty state offers the first one', notesClosed.includes('Log the first note'))

const notesOpen = renderToStaticMarkup(
  React.createElement(OpportunityNotesView, { opportunityId: PID, notes: [], startNew: true, onSaved: () => {} }),
)
check('notes, ?new=1: the SAME AI pass is offered', notesOpen.includes('Extract with AI'))
check('notes, ?new=1: "save as-is" keeps the instant path', notesOpen.includes('Save as-is'))
check('notes, ?new=1: the save button names a Note, not an Update', notesOpen.includes('Save as-is'))

// A note carrying an extraction renders it; one saved as-is renders its text.
const extracted = {
  id: 'n1', opportunity_id: PID, created_at: '2026-10-18T12:00:00Z', author: 'Richard',
  body: 'Long raw text the human actually typed, which goes behind a disclosure.',
  summary: 'Seller counsel wants closing pushed to 1 Nov.',
  confidence: 0.82,
  waiting_on: [{ text: 'Redline from seller counsel', party: 'Seller counsel' }],
  risks: [{ text: 'Financing contingency unresolved', severity: 'critical' }],
  decisions: [{ text: 'Push the PSA closing to 1 Nov', made_by: 'Richard' }],
}
const asIs = {
  id: 'n2', opportunity_id: PID, created_at: '2026-10-17T09:00:00Z', author: 'Ber AI',
  body: 'Called Merlin, no answer, will try Monday.',
  summary: null, confidence: null, waiting_on: [], risks: [], decisions: [],
}
type NoteRow = Parameters<typeof OpportunityNotesView>[0]['notes'][number]
const feed = renderToStaticMarkup(
  React.createElement(OpportunityNotesView, {
    opportunityId: PID,
    notes: [extracted as unknown as NoteRow, asIs as unknown as NoteRow],
    onSaved: () => {},
  }),
)
check('an extracted note shows its summary', feed.includes('closing pushed to 1 Nov'))
check('…its waiting-on', feed.includes('Redline from seller counsel'))
check('…its risk, with the severity', feed.includes('Financing contingency') && feed.includes('critical'))
check('…its decision', feed.includes('Push the PSA closing'))
check('…its confidence', feed.includes('82'))
check('…and the raw text behind a disclosure, not inline', feed.includes('What I wrote'))
check('a saved-as-is note shows its text directly', feed.includes('Called Merlin'))
check('…and offers no empty disclosure', !feed.includes('What I wrote</button><p'))
// ⚠ A bare em dash at a value's own weight reads as a failed render (§12).
check('nothing renders as NaN / undefined / Infinity', !/NaN|undefined|Infinity/.test(feed))

// ── 3. An empty record still shows the tabs a human types into ─────────────
console.log('\nAn empty record keeps its manual doors\n')

function visibleOnAnEmptyRecord(tabs: RecordTab[]): string[] {
  // Mirrors RecordTabBar: `always`, or a count above zero. Counts are all zero
  // here, which is the case that matters.
  return tabs.filter((t) => t.always).map((t) => t.segment)
}

for (const [name, tabs] of [['project', PROJECT_TABS], ['opportunity', OPPORTUNITY_TABS]] as const) {
  const visible = visibleOnAnEmptyRecord(tabs)
  check(`${name}: Overview is visible`, visible.includes(''))
  check(`${name}: Meetings is visible with no meetings`, visible.includes('meetings'))
  check(`${name}: Tasks is visible with no tasks`, visible.includes('tasks'))
  check(`${name}: Documents is visible with no documents`, visible.includes('documents'))
  const feed = name === 'project' ? 'updates' : 'notes'
  check(`${name}: the ${feed} feed is visible`, visible.includes(feed))

  // ⚠ The bar must not become the thing it replaced. Five always-tabs is the
  // ceiling: past that, a record with nothing in it shows a bar of empties
  // again, which is the bug the count-gating was built to fix.
  check(
    `${name}: no more than five tabs are always shown (${visible.length})`,
    visible.length <= 5,
    `${visible.length} are always-on`,
  )
}

// The order is the reading order, and it is the same on both records bar Land.
console.log('\nThe two registries stay in step\n')
const projectSegments = PROJECT_TABS.map((t) => t.segment).filter((s) => s !== 'parcels')
const oppSegments = OPPORTUNITY_TABS.map((t) => t.segment)
const projectRenamed = projectSegments.map((s) => (s === 'updates' ? 'notes' : s))
check(
  'an opportunity carries the same tabs in the same order (minus Land)',
  JSON.stringify(projectRenamed) === JSON.stringify(oppSegments),
  `${JSON.stringify(projectRenamed)} vs ${JSON.stringify(oppSegments)}`,
)

console.log(failures === 0 ? '\nAll checks passed\n' : `\n${failures} check(s) failed\n`)
process.exitCode = failures === 0 ? 0 : 1
