import type { RecordTab } from './RecordTabBar'

/**
 * A project's tabs, in reading order: what it IS, then what has HAPPENED, then
 * the EVIDENCE, then the MONEY.
 *
 *   Overview                              — what is this deal
 *   Updates · Meetings · Tasks            — the pulse: what happened, what was
 *                                           said, what we owe
 *   Documents · Players · Milestones      — the file: the paper, the people,
 *                                           the dates that bind us
 *   Land · Economics · Vehicles ·         — the structure: what it is made of,
 *   Financing · Diligence · Entities        what it is worth, who owns it,
 *                                           how it is funded, what is unresolved
 *
 * Vehicles still sits before Economics because the structure is decided first:
 * which SPV holds the land is settled long before anyone prices the deal, and
 * a revenue line cannot name a vehicle that does not exist yet.
 *
 * ⚠ WHICH TABS ARE `always` IS A DISCOVERABILITY DECISION, NOT A FREQUENCY ONE.
 * Gating a tab on having rows is right for reading a populated record and
 * exactly wrong for the first write. Measured 2026-10-18 on live data:
 * Documents 17/19 projects, Updates 14/19, Players 13/19, Tasks 4/19,
 * Milestones 2/19, Meetings 2/19, and Financing / Diligence / Entities /
 * Economics on none. By rows alone Meetings and Tasks belong under More — and
 * they are the two tabs a human TYPES into, so on 17 of 19 projects the only
 * door to logging a meeting was behind a menu labelled "More". Both are
 * `always` now, and `RecordLogMenu` in the header is the door that does not
 * depend on a count at all.
 *
 * Economics stays counted rather than `always`: a deal with no model is
 * offered one from the Overview instead.
 */
export const PROJECT_TABS: RecordTab[] = [
  { label: 'Overview', segment: '', always: true },
  { label: 'Updates', segment: 'updates', key: 'updates', always: true },
  { label: 'Meetings', segment: 'meetings', key: 'meetings', always: true },
  { label: 'Tasks', segment: 'tasks', key: 'tasks', always: true },
  { label: 'Documents', segment: 'documents', key: 'documents', always: true },
  { label: 'Players', segment: 'players', key: 'players' },
  { label: 'Milestones', segment: 'milestones', key: 'milestones' },
  { label: 'Land', segment: 'parcels', key: 'parcels' },
  { label: 'Economics', segment: 'economics', key: 'economics' },
  { label: 'Vehicles', segment: 'vehicles', key: 'vehicles' },
  { label: 'Financing', segment: 'financing', key: 'financing' },
  { label: 'Diligence', segment: 'diligence', key: 'diligence' },
  { label: 'Entities & Vendors', segment: 'entities', key: 'entities' },
]

/**
 * The same set and the same order for an opportunity, with two deliberate
 * differences in wording — a deal's running commentary is its progress Notes
 * (`opportunity_notes`) rather than project Updates, and there is no Land tab
 * because parcels hang off a project. The segments and the child tables
 * underneath are otherwise identical, which is why one bar serves both.
 */
export const OPPORTUNITY_TABS: RecordTab[] = [
  { label: 'Overview', segment: '', always: true },
  { label: 'Notes', segment: 'notes', key: 'updates', always: true },
  { label: 'Meetings', segment: 'meetings', key: 'meetings', always: true },
  { label: 'Tasks', segment: 'tasks', key: 'tasks', always: true },
  { label: 'Documents', segment: 'documents', key: 'documents', always: true },
  { label: 'Players', segment: 'players', key: 'players' },
  { label: 'Milestones', segment: 'milestones', key: 'milestones' },
  { label: 'Economics', segment: 'economics', key: 'economics' },
  { label: 'Vehicles', segment: 'vehicles', key: 'vehicles' },
  { label: 'Financing', segment: 'financing', key: 'financing' },
  { label: 'Diligence', segment: 'diligence', key: 'diligence' },
  { label: 'Entities & Vendors', segment: 'entities', key: 'entities' },
]
