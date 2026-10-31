/**
 * The report vocabulary. One row per canned report, and nothing anywhere else
 * may hold a second copy of this list.
 *
 * ⚠ `Record<ReportKey, ReportDef>` IS THE WHOLE DESIGN. §12 names this exactly:
 * *"A hand-written enumeration beside a registry drifts, and a ⚠ comment saying
 * so does not stop the SIBLING drifting — or the next COMPONENT… THE FIX THAT
 * ENDS IT IS THE TYPE, NOT THE DERIVATION."* It cost three repeats here —
 * /decide's chip row, the Documents tab's filter (163 documents it could not
 * reach), then /jobs. So the index page, the screen view, the print route and
 * the spreadsheet route all derive from this map, and adding a report without
 * wiring one of them is a build error rather than a 404 at a scheduled hour.
 *
 * ⚠ AND THE TRAILING `else` IS WHAT MAKES A MISSING ARM DANGEROUS RATHER THAN
 * LOUD. `/decide`'s accept chain tested two document kinds and a third fell
 * through, so 120 rows answered 404 — green through typecheck, build and 802
 * tests. There is no `default` in this module and `reportDef()` returns null
 * for an unknown key, which the routes turn into `notFound()`.
 */

import {
  FolderKanban,
  Users,
  Zap,
  FolderCheck,
  Activity,
  type LucideIcon,
} from 'lucide-react'

import type { DealRegister } from './deals'
import type { ReportData } from './types'

export const REPORT_KEYS = ['pipeline', 'capacity', 'data-room', 'deal-team', 'activity'] as const
export type ReportKey = (typeof REPORT_KEYS)[number]

export function isReportKey(value: unknown): value is ReportKey {
  return typeof value === 'string' && (REPORT_KEYS as readonly string[]).includes(value)
}

export interface ReportDef {
  key: ReportKey
  /** The title on the card, the page and the letterhead. */
  title: string
  /** One sentence on the index card. */
  blurb: string
  icon: LucideIcon
  /**
   * Build the report from the shared deal register.
   *
   * ⚠ IT TAKES THE REGISTER RATHER THAN READING ITS OWN DEALS. That is what
   * stops five builders disagreeing about how many deals there are, and —
   * more to the point — what stops the one that forgot to drop confidential
   * projects being found last (`deals.ts` carries the full reasoning).
   */
  build: (register: DealRegister) => ReportData | Promise<ReportData>
  /**
   * Named here, not computed, so the index page can say what a report covers
   * without building all five. A sentence about the DATA, in the present
   * tense — the card is where somebody decides whether to open it.
   */
  covers: (register: DealRegister) => string
}

/*
 * ⚠ THE BUILDERS ARE IMPORTED LAZILY AND THAT IS DELIBERATE. The index page
 * renders five cards and builds nothing; a static import would pull every
 * builder — and `readRoomStatus`'s four-queries-per-room Drive read behind the
 * data-room one — into the bundle for a page that only needs five titles.
 */
export const REPORTS: Record<ReportKey, ReportDef> = {
  pipeline: {
    key: 'pipeline',
    title: 'Pipeline Summary',
    blurb:
      'Every live deal by stage, with capacity, value, win band and the dates that move. The one to send when somebody asks what we are working on.',
    icon: FolderKanban,
    build: async (register) =>
      (await import('./build/pipeline')).buildPipelineReport(register),
    covers: (register) => {
      const priced = register.deals.filter((deal) => deal.estimatedValue !== null).length
      return `${register.deals.length} deals · ${priced} priced`
    },
  },
  capacity: {
    key: 'capacity',
    title: 'Capacity & Ramp-up',
    blurb:
      'Megawatts by deal and by year — every tranche, when it comes online, and what is live once it lands.',
    icon: Zap,
    build: async (register) =>
      (await import('./build/capacity')).buildCapacityReport(register),
    covers: (register) => {
      const scheduled = new Set(
        register.phases.map((phase) => phase.project_id ?? phase.opportunity_id).filter(Boolean)
      ).size
      return scheduled === 0
        ? `No ramp-up schedules entered yet`
        : `${scheduled} of ${register.deals.length} deals scheduled`
    },
  },
  'data-room': {
    key: 'data-room',
    title: 'Data Room Readiness',
    blurb:
      'How full each diligence room is: what is on the shelves, what a person has verified, and the sections still empty.',
    icon: FolderCheck,
    build: async (register) =>
      (await import('./build/data-room')).buildDataRoomReport(register),
    covers: (register) => {
      const rooms = register.deals.filter((deal) => deal.dataRoomTemplate === 'data_center').length
      return `${rooms} deal${rooms === 1 ? '' : 's'} on the 19-section room`
    },
  },
  'deal-team': {
    key: 'deal-team',
    title: 'Deal Team & Relationships',
    blurb:
      'Who is round the table on each deal, and everywhere one name appears across the portfolio.',
    icon: Users,
    build: async (register) =>
      (await import('./build/deal-team')).buildDealTeamReport(register),
    covers: () => 'Every person and firm attached to a deal',
  },
  activity: {
    key: 'activity',
    title: 'Portfolio Activity',
    blurb:
      'Last contact on every deal, what is owed, and which deals have gone quiet — the drift nothing else surfaces.',
    icon: Activity,
    build: async (register) =>
      (await import('./build/activity')).buildActivityReport(register),
    covers: (register) => `${register.deals.length} deals, quietest first`,
  },
}

/** Index order. Pipeline first because it is the one somebody came for. */
export const REPORT_ORDER: ReportKey[] = ['pipeline', 'capacity', 'data-room', 'deal-team', 'activity']

/** The definition for a key off a URL, or null — never a fallback (see the header ⚠). */
export function reportDef(key: string): ReportDef | null {
  return isReportKey(key) ? REPORTS[key] : null
}
