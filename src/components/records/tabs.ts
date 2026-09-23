import type { RecordTab } from './RecordTabBar'

/**
 * A project's tabs. Overview / Updates / Documents always show; the rest
 * appear once that project has rows in them.
 */
export const PROJECT_TABS: RecordTab[] = [
  { label: 'Overview', segment: '', always: true },
  { label: 'Updates', segment: 'updates', key: 'updates', always: true },
  { label: 'Documents', segment: 'documents', key: 'documents', always: true },
  { label: 'Players', segment: 'players', key: 'players' },
  { label: 'Meetings', segment: 'meetings', key: 'meetings' },
  { label: 'Tasks', segment: 'tasks', key: 'tasks' },
  { label: 'Milestones', segment: 'milestones', key: 'milestones' },
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
  { label: 'Financing', segment: 'financing', key: 'financing' },
  { label: 'Diligence', segment: 'diligence', key: 'diligence' },
  { label: 'Entities & Vendors', segment: 'entities', key: 'entities' },
]
