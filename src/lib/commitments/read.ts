/**
 * The one way to read open commitments.
 *
 * ⚠ THIS EXISTS BECAUSE A PROTECTED PROJECT'S OBLIGATIONS WERE GOING OUT IN
 * SENT EMAIL. `tasks/queries.ts` drops hidden projects, `attention.ts` drops
 * hidden projects, and the commitment ledger — read straight out of
 * `assembleCommon`, `loadOpenCommitments` and `counterpartyContext` with no
 * filter at all — did not. 49 open commitments carry a `project_id`, Pepper's
 * note is an OUTBOUND channel, and nothing anywhere reported the gap. It is the
 * same shape as the 10-08 finding about `investments.spv_id`: a table nobody
 * thought of as project-scoped turning out to name a deal.
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

/** A commitment plus the mailbox of the thread it was read out of. */
export type CommitmentWithMailbox = CommitmentRow & { mailbox: string | null }

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
  /** PostgREST caps at 1000 rows silently (§12) — pass what you can render. */
  limit?: number
}

export interface OpenCommitments {
  rows: CommitmentWithMailbox[]
  /** Stated out loud, never swallowed into an empty list. */
  error: string | null
  /** How many rows the confidentiality filter withheld. */
  withheld: number
}

export async function readOpenCommitments(
  opts: ReadOpenOptions = {}
): Promise<OpenCommitments> {
  const { authUserId = null, excludeSnoozed = false, side, limit = 500 } = opts
  const today = new Date().toISOString().slice(0, 10)

  const hidden = await hiddenProjectIds(authUserId)

  let query = sweepDb()
    .from('commitments')
    // The mailbox comes along because it is the fallback attribution key and
    // the join is free here — resolving it later would be one query per row.
    .select('*, thread:email_threads(mailbox)')
    .eq('status', 'open')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(limit)

  if (side) query = query.eq('side', side)

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
   */
  const withheldPromise =
    hidden.size > 0
      ? sweepDb()
          .from('commitments')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'open')
          .in('project_id', [...hidden])
          .then((r) => r.count ?? 0)
      : Promise.resolve(0)

  const [{ data, error }, withheld] = await Promise.all([query, withheldPromise])

  if (error) {
    return { rows: [], error: error.message, withheld }
  }

  const rows = ((data ?? []) as (CommitmentRow & { thread: unknown })[]).map((row) => {
    const t = Array.isArray(row.thread) ? row.thread[0] : row.thread
    return { ...row, mailbox: (t as { mailbox?: string } | null)?.mailbox ?? null }
  })

  // The post-filter is a BACKSTOP, never the mechanism — it catches the case
  // where the `.or()` above could not be built and costs nothing when the SQL
  // already did the work. It is NOT where `withheld` comes from; see above.
  const visible =
    hidden.size > 0 ? rows.filter((r) => !r.project_id || !hidden.has(r.project_id)) : rows

  return { rows: visible, error: null, withheld }
}
