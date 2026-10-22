/**
 * How many inbound leads still need working — the number on the sidebar badge.
 *
 * ⚠ THIS BADGE IS THE PRICE OF TAKING LEADS OFF /decide (10-22, Richard's
 * direction: *"remove leads entirely, add the badge"*). Before this, /leads was
 * a plain nav row under Records with no count of any kind, and the only thing
 * that told anyone a bid invitation had arrived was the Decide queue — where it
 * sat beside Steelton's closing and GridEdge's figures, which is the complaint.
 *
 * ⚠ AND A BID DATE WAS THE ONLY HARD DEADLINE IN THAT QUEUE. `decideWeight`
 * ranked on it and the page printed "N closing within a week", so removing the
 * rows without carrying the deadline somewhere would have traded a cluttered
 * screen for a missed bid. Measured on the day of the change: 9 leads needed
 * working and TWO closed that same day. Hence `closingSoon` beside `open` —
 * two quantities, named apart, never summed (§12).
 *
 * The predicate itself is NOT written here. It lives in `src/lib/utils/leads.ts`
 * with its SQL and row halves side by side, because the /leads header applies
 * the row half to leads the page already holds and the two must not drift —
 * which is exactly how the old /decide badge came to disagree with /decide.
 */
import { leadsDb } from '@/lib/leads/db'
import {
  LEAD_NEEDS_WORK_STATUSES,
  LEAD_NEEDS_WORK_FIT_FILTER,
  leadClosingSoon,
} from '@/lib/utils/leads'

export interface LeadQueueCounts {
  /** Leads awaiting a human: status new|reviewing, verdict not `pass`. */
  open: number
  /** Of those, the ones whose bid date is inside a week. A subset, never a sum. */
  closingSoon: number
}

/**
 * ⚠ ONE QUERY, NOT A head:true COUNT PLUS A SECOND FOR THE DEADLINES.
 *
 * `closingSoon` has to be derived from the same row set as `open` or it can
 * exceed it — and a badge whose urgent count is larger than its total is one
 * nobody believes again. `bid_due_date` could be filtered in SQL, but then the
 * window lives in two places (here and `leadClosingSoon`) and the "within a
 * week" on the screen could come to mean something different from the badge's.
 *
 * ⚠ `now` DEFAULTS HERE RATHER THAN BEING PASSED BY THE CALLER. The root layout
 * is the caller, and `Date.now()` written in a server component's body trips
 * react-hooks/purity — the same misfire §9 records against /dashboard, which it
 * calls runtime-fine and leaves alone. There was no reason to add a third: this
 * is an async function, not a render, so the clock is honestly its own. It stays
 * a PARAMETER so a test can pin it.
 *
 * The row set is small by construction: these are leads nobody has decided yet,
 * measured at 9. The `limit` is a guard against a pathological backlog, not a
 * page size — and it is above PostgREST's silent 1000-row cap on purpose, so a
 * truncated read cannot quietly under-report (§12).
 */
export async function countLeadsNeedingWork(now = Date.now()): Promise<LeadQueueCounts> {
  const { data, error } = await leadsDb()
    .from('leads')
    .select('bid_due_date')
    .in('status', LEAD_NEEDS_WORK_STATUSES as unknown as string[])
    // NOT `.neq('pass')`. PostgREST treats NULL as not matching, so that would
    // drop every untriaged bid invitation — the rows that most need a human.
    .or(LEAD_NEEDS_WORK_FIT_FILTER)
    .limit(2000)

  // A failed read is not "no leads". Returning zeros would hide the queue
  // behind a badge that looks deliberately empty; the caller treats a throw as
  // "say nothing" instead, which is honestly different from "nothing waiting".
  if (error) throw new Error(`Could not count leads: ${error.message}`)

  const rows = (data ?? []) as { bid_due_date: string | null }[]
  return {
    open: rows.length,
    closingSoon: rows.filter((r) => leadClosingSoon(r, now)).length,
  }
}
