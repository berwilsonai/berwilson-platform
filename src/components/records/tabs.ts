import type { RecordTab } from './RecordTabBar'

/**
 * A project's tabs. Overview / Updates / Documents always show; the rest
 * appear once that project has rows in them.
 *
 * Vehicles sits before Economics because the structure is decided first: which
 * SPV holds the land is settled long before anyone prices the deal, and a
 * revenue line cannot name a vehicle that does not exist yet. It is counted
 * like the rest, so it appears only once a deal has one.
 *
 * Economics is counted rather than `always`, deliberately. Measured on
 * 2026-09-21, four of ten tabs had rows on zero of fifteen projects while
 * every project showed all ten, so the two tabs that carry the work sat sixth
 * and seventh along a bar you had to scan past seven empty ones to reach. A
 * deal with no economics model is offered one from the Overview instead.
 */
export const PROJECT_TABS: RecordTab[] = [
  { label: 'Overview', segment: '', always: true },
  { label: 'Updates', segment: 'updates', key: 'updates', always: true },
  { label: 'Documents', segment: 'documents', key: 'documents', always: true },
  { label: 'Land', segment: 'parcels', key: 'parcels' },
  { label: 'Players', segment: 'players', key: 'players' },
  { label: 'Meetings', segment: 'meetings', key: 'meetings' },
  { label: 'Tasks', segment: 'tasks', key: 'tasks' },
  { label: 'Milestones', segment: 'milestones', key: 'milestones' },
  { label: 'Vehicles', segment: 'vehicles', key: 'vehicles' },
  { label: 'Economics', segment: 'economics', key: 'economics' },
  { label: 'Financing', segment: 'financing', key: 'financing' },
  { label: 'Diligence', segment: 'diligence', key: 'diligence' },
  { label: 'Entities & Vendors', segment: 'entities', key: 'entities' },
]

/**
 * The same set for an opportunity, with two deliberate differences in wording:
 * a deal's running commentary is its progress Notes rather than project
 * Updates, and its diligence is the deal's own checklist. The segments and
 * the child tables underneath are identical.
 */
export const OPPORTUNITY_TABS: RecordTab[] = [
  { label: 'Overview', segment: '', always: true },
  { label: 'Notes', segment: 'notes', key: 'updates', always: true },
  { label: 'Documents', segment: 'documents', key: 'documents', always: true },
  { label: 'Players', segment: 'players', key: 'players' },
  { label: 'Meetings', segment: 'meetings', key: 'meetings' },
  { label: 'Tasks', segment: 'tasks', key: 'tasks' },
  { label: 'Milestones', segment: 'milestones', key: 'milestones' },
  { label: 'Vehicles', segment: 'vehicles', key: 'vehicles' },
  { label: 'Economics', segment: 'economics', key: 'economics' },
  { label: 'Financing', segment: 'financing', key: 'financing' },
  { label: 'Diligence', segment: 'diligence', key: 'diligence' },
  { label: 'Entities & Vendors', segment: 'entities', key: 'entities' },
]
