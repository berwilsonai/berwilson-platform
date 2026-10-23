/**
 * The one way to read open commitments.
 *
 * ⚠ THIS EXISTS BECAUSE A PROTECTED PROJECT'S OBLIGATIONS WERE GOING OUT IN
 * SENT EMAIL. `tasks/queries.ts` drops hidden projects, `attention.ts` drops
 * hidden projects, and the commitment ledger — read straight out of
 * `assembleCommon`, `loadOpenCommitments` and `counterpartyContext` with no
 * filter at all — did not. 49 open commitments carry a `project_id`, Pepper's
 * note is an OUTBOUND channel, and nothing anywhere reported the gap. It is the
 * same shape as the 10-08 finding about `investments.spv_id` (a column since
 * dropped with the Vehicles module): a table nobody thought of as
 * project-scoped turning out to name a deal.
 *
 * Nothing is leaking today — `projects.confidential` is true for 0 rows as of
 * 2026-10-09 — which is exactly why it had to be fixed now rather than on the
 * morning somebody protects a deal and a sent note quietly carries its
 * obligations out of the box.
 *
 * §12: a security filter belongs at the choke point as a DEFAULT, not as a
 * parameter every caller passes. Forgetting to opt in costs a few rows;
 * forgetting to opt out costs the secret. So the filter is unconditional here
 * and there is no flag to switch it off — a caller who wants the protected rows
 * must read the table itself and say in its own comment why that is allowed.
 */

import { sweepDb } from '@/lib/email-sweep/db'
import { hiddenProjectIds, notInList } from '@/lib/security/confidential'
import type { CommitmentRow } from './db'

/** A commitment plus the mailbox and last activity of its thread. */
export type CommitmentWithMailbox = CommitmentRow & {
  mailbox: string | null
  thread_last_at: string | null
}

export interface ReadOpenOptions {
  /**
   * Which viewer is asking, for step-up. Omitted or null means NOBODY — the
   * absolute answer, which is what every cron and every outbound channel needs.
   * `hiddenProjectIds` is built so that a job which forgets to pass a user gets
   * the SAFE behaviour rather than the permissive one.
   */
  authUserId?: string | null
  /** Hide rows snoozed past today. The note and the default page view do. */
  excludeSnoozed?: boolean
  side?: 'us' | 'them'
  /**
   * Restrict to these `email_threads.id` values.
   *
   * Added 2026-10-11 so `counterpartyContext` could stop reading the table
   * itself. It wanted obligations for one counterparty's threads, which is why
   * it had its own query — and that query carried no confidentiality filter, so
   * a protected deal's obligations reached the SENT morning note through the
   * one path that looked too narrow to matter. A targeted read is a reason to
   * extend the choke point, never a reason to go around it.
   */
  threadIds?: string[]
  /** PostgREST caps at 1000 rows silently (§12) — pass what you can render. */
  limit?: number
  /**
   * Row order. Defaults to `due` — the deadline-first order every outbound
   * channel wants, and the one this function has always applied.
   *
   * ⚠ `due` IS THE WRONG DEFAULT FOR A SCREEN AND WAS THE ONLY ONE ON OFFER.
   * It reads `due_date asc nullsFirst:false` then `created_at ASC`, so with 213
   * of 244 open rows carrying no date the page was 87% oldest-first — anything
   * the extractor found this week sat at the bottom of a 244-row list. The
   * module header on `list.ts` claimed "newest attention first" the whole time,
   * which is §12's rule about a comment describing a control that is not there.
   *
   * `newest` is what the page now defaults to. `activity` cannot be ordered
   * here (it lives on the joined thread, and PostgREST will not order a filtered
   * read by an embedded column) — `list.ts` sorts that one in memory.
   */
  sort?: CommitmentSort
}

/**
 * The orders a reader can ask for.
 *
 * A union rather than free text because it reaches `.order()`: §12 records that
 * a value outside an enum fails the WHOLE query with `22P02` and a NULL row
 * set, which every caller here would swallow into "no commitments".
 */
export type CommitmentSort = 'due' | 'newest' | 'oldest' | 'activity'

export interface OpenCommitments {
  rows: CommitmentWithMailbox[]
  /** Stated out loud, never swallowed into an empty list. */
  error: string | null
  /** How many rows the confidentiality filter withheld. */
  withheld: number
}

/**
 * Apply one of the four orders.
 *
 * Generic over the builder rather than typed to it: PostgREST's filter builder
 * changes type on every `.order()`, and naming the concrete type here would
 * pin this to one shape of query.
 *
 * ⚠ `activity` DELIBERATELY FALLS BACK TO `newest` RATHER THAN ORDERING BY THE
 * EMBEDDED COLUMN. `order('thread(last_at)')` is accepted by PostgREST and
 * silently returns the rows in an arbitrary order once the read is also
 * filtered — the same class of silent-wrong as §12's note on `.filter()`
 * dropping a cast. `list.ts` sorts that view in memory, where the thread date
 * is already in hand.
 */
function applySort<T extends { order: (col: string, o: { ascending: boolean; nullsFirst?: boolean }) => T }>(
  q: T,
  sort: CommitmentSort
): T {
  switch (sort) {
    case 'newest':
    case 'activity':
      return q.order('created_at', { ascending: false })
    case 'oldest':
      return q.order('created_at', { ascending: true })
    case 'due':
    default:
      return q
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
  }
}

export async function readOpenCommitments(
  opts: ReadOpenOptions = {}
): Promise<OpenCommitments> {
  const { authUserId = null, excludeSnoozed = false, side, threadIds, limit = 500, sort = 'due' } = opts
  const today = new Date().toISOString().slice(0, 10)

  const hidden = await hiddenProjectIds(authUserId)

  const base = sweepDb()
    .from('commitments')
    // The mailbox comes along because it is the fallback attribution key and
    // the join is free here — resolving it later would be one query per row.
    // `last_at` rides with it for the same reason: it is what tells a reader
    // whether an obligation is quiet because it is done or because the whole
    // conversation stopped, and it is the key the `activity` sort orders by.
    .select('*, thread:email_threads(mailbox, last_at)')
    .eq('status', 'open')

  let query = applySort(base, sort).limit(limit)

  if (side) query = query.eq('side', side)

  // An empty array must mean "no threads", not "every thread" — `.in()` with
  // nothing in it is the shape that silently widens a filter into no filter.
  if (threadIds) {
    if (threadIds.length === 0) return { rows: [], error: null, withheld: 0 }
    query = query.in('thread_id', threadIds)
  }

  // ⚠ APPLIED IN SQL, BEFORE THE LIMIT. §12: a ranking's LIMIT runs first, so
  // withheld rows at the top of the order would return a short list rather than
  // the next real ones — and a short list reads as "there is nothing on file".
  const exclude = notInList(hidden)
  // `notInList` already returns the value bracketed, so no parentheses here.
  if (exclude) query = query.or(`project_id.is.null,project_id.not.in.${exclude}`)

  // Snoozed rows are excluded in SQL for the same reason.
  if (excludeSnoozed) query = query.or(`snoozed_until.is.null,snoozed_until.lte.${today}`)

  /**
   * How many rows the confidentiality filter is holding back.
   *
   * ⚠ A SEPARATE COUNT, BECAUSE THE OBVIOUS ARITHMETIC IS ALWAYS ZERO. The
   * first version computed this as `rows.length - visible.length` after the
   * in-memory backstop — but the SQL filter has already excluded them by then,
   * so it reported 0 against 22 genuinely withheld rows and the page's
   * disclosure could never appear. §12: withholding from a reader means handing
   * them the COUNT, and a count that is structurally zero is worse than none
   * because the screen then asserts completeness it does not have.
   *
   * Only asked when something is actually hidden, so the normal case costs
   * nothing.
   *
   * ⚠ AND IT CARRIES THE CALLER'S OWN PREDICATES, WHICH IT DID NOT. The count
   * was taken over every open row on a protected project, ignoring `side`,
   * `threadIds` and `excludeSnoozed` — so `listCommitments({side:'us'})`
   * disclosed "22 withheld" drawn from both sides, and a meeting's
   * thread-scoped read disclosed the whole portfolio's protected backlog
   * against four rows. §12: one quantity, one definition. A disclosure that
   * describes a different population than the list it sits under is a third
   * number masquerading as a reconciliation.
   */
  let withheldQuery =
    hidden.size > 0
      ? sweepDb()
          .from('commitments')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'open')
          .in('project_id', [...hidden])
      : null

  if (withheldQuery) {
    if (side) withheldQuery = withheldQuery.eq('side', side)
    // `threadIds` is never empty here — the empty case returned above.
    if (threadIds) withheldQuery = withheldQuery.in('thread_id', threadIds)
    if (excludeSnoozed) {
      withheldQuery = withheldQuery.or(`snoozed_until.is.null,snoozed_until.lte.${today}`)
    }
  }

  const withheldPromise = withheldQuery
    ? withheldQuery.then((r) => r.count ?? 0)
    : Promise.resolve(0)

  const [{ data, error }, withheld] = await Promise.all([query, withheldPromise])

  if (error) {
    return { rows: [], error: error.message, withheld }
  }

  const rows = ((data ?? []) as (CommitmentRow & { thread: unknown })[]).map((row) => {
    const t = Array.isArray(row.thread) ? row.thread[0] : row.thread
    const embedded = t as { mailbox?: string; last_at?: string | null } | null
    return {
      ...row,
      mailbox: embedded?.mailbox ?? null,
      thread_last_at: embedded?.last_at ?? null,
    }
  })

  // The post-filter is a BACKSTOP, never the mechanism — it catches the case
  // where the `.or()` above could not be built and costs nothing when the SQL
  // already did the work. It is NOT where `withheld` comes from; see above.
  const visible =
    hidden.size > 0 ? rows.filter((r) => !r.project_id || !hidden.has(r.project_id)) : rows

  return { rows: visible, error: null, withheld }
}
