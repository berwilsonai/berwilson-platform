/**
 * Is a record still live enough to receive mail, documents and notifications?
 *
 * ONE definition, because the answer is asked in four places that had drifted:
 * apply-phase posted correspondence onto anything, Drive filing filed into
 * anything, the publish reconcile published anything, and only
 * project-folder-sync filtered at all — in JS, on two of the three dormant
 * statuses.
 *
 * ⚠ THE JS FILTER IS NOT AN OVERSIGHT AND MUST BE PRESERVED. A PostgREST
 * `status=not.in.(closed,lost)` evaluates to NULL for a row whose status is
 * NULL, and PostgREST treats NULL as not matching — so the filter would
 * silently drop every record with no status set. There is one such project
 * today. Load the rows, then decide here.
 *
 * The rule (Richard's call, 2026-09-22): "still live" is generous on the
 * pursuit end and strict on the terminal end. A bid you are chasing still pulls
 * in its drawings and addenda — that is exactly when you need them. A dead
 * pursuit stops cold.
 */

import { OPPORTUNITY_PIPELINE } from '@/lib/utils/opportunities'
import { isLostStage } from '@/lib/utils/steel'
import type { LinkRecordKind } from '@/lib/email-sweep/db'

/**
 * Project statuses that are NOT live.
 *
 * Expressed as the exclusion rather than the inclusion so a status added to the
 * enum later defaults to live. Being too quiet is the failure mode that looks
 * like the platform is broken; being too noisy is visible and fixable.
 */
const DORMANT_PROJECT_STATUSES: ReadonlySet<string> = new Set(['lost', 'closed', 'on_hold'])

export function isProjectLive(status: string | null | undefined): boolean {
  if (!status) return true
  return !DORMANT_PROJECT_STATUSES.has(status)
}

/**
 * Opportunities: the six pipeline stages are live; on_hold, closed_won and
 * closed_passed are not.
 *
 * `closed_won` being dormant is worth stating plainly, because it is the one
 * that could surprise: a completed acquisition stops accruing correspondence,
 * so post-close integration mail lands nowhere. That is the reading of "active
 * opps" this was built to; reopening the record resumes the flow, and the link
 * is kept meanwhile so nothing is lost in the gap.
 */
export function isOpportunityLive(status: string | null | undefined): boolean {
  if (!status) return true
  return (OPPORTUNITY_PIPELINE as readonly string[]).includes(status)
}

/**
 * Steel deals gate on `lost` alone.
 *
 * Deliberately looser than the other two: `paid` is a completed sale, and
 * warranty, punch-list and follow-on mail after one is real correspondence that
 * belongs on the deal.
 */
export function isSteelDealLive(stage: string | null | undefined): boolean {
  return !isLostStage(stage)
}

/** The status/stage field each kind is judged on. */
export interface LiveCheckRow {
  status?: string | null
  stage?: string | null
}

/**
 * Dispatch by record kind. Leads are always live — a lead is by definition
 * undecided, and its own queue already drains itself (see drainLeadQueue).
 */
export function isRecordLive(kind: LinkRecordKind, row: LiveCheckRow): boolean {
  switch (kind) {
    case 'project':
      return isProjectLive(row.status)
    case 'opportunity':
      return isOpportunityLive(row.status)
    case 'steel_deal':
      return isSteelDealLive(row.stage)
    default:
      return true
  }
}
