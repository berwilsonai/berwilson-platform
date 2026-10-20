/**
 * The commitments page's read: the whole ledger, filterable.
 *
 * ⚠ WHY A PAGE HAD TO EXIST. The only settle surface was the dashboard panel,
 * which reads 24 rows ordered `due_date … nullsFirst: false`. Measured
 * 2026-10-09: 369 of 476 open commitments carry no date, so they sorted below
 * that cap permanently — 78% of the ledger was unreachable from the only place
 * that could close it, and `count(settled_by)` across the whole table was 0.
 *
 * So the default view here is deliberately the opposite of the panel's: every
 * open row, newest attention first, with the undated ones present rather than
 * exiled to the bottom of a list that gets cut.
 */

import { sweepDb } from '@/lib/email-sweep/db'
import { hiddenProjectIds, notInList } from '@/lib/security/confidential'
import { readOpenCommitments, type CommitmentSort } from './read'
import { HUMAN_SETTLED, type CommitmentRow, type CommitmentStatus } from './db'

export interface CommitmentListItem {
  id: string
  what: string
  side: 'us' | 'them'
  status: CommitmentStatus
  owner_name: string | null
  due_date: string | null
  created_at: string | null
  snoozed_until: string | null
  project_id: string | null
  opportunity_id: string | null
  record_name: string | null
  mailbox: string | null
  chase_text: string | null
  chase_drafted_at: string | null
  /**
   * The newest message on the conversation this came from.
   *
   * Carried so the reader can see WHY a row is quiet — a 3-day-old obligation
   * on a thread nobody has touched in six weeks is a different thing from one
   * on a live negotiation, and the age of the row alone cannot tell them
   * apart. It is also the key the `activity` sort orders by (in memory — see
   * the note on `applySort`).
   */
  thread_last_at: string | null
}

export interface CommitmentListFilters {
  side?: 'us' | 'them'
  /**
   * 'open' hides snoozed rows; 'quiet' shows only them; 'settled' the human
   * history; 'retired' what the aging pass closed.
   *
   * ⚠ 'retired' EXISTS SO THE AGING PASS IS REVERSIBLE IN PRACTICE AND NOT
   * ONLY IN PRINCIPLE. A row it closes is `resolved`, which every other view
   * filters out — so without this the undo (`settleCommitment(id,'open')`)
   * existed with no screen that could reach the row.
   */
  view?: 'open' | 'quiet' | 'settled' | 'all' | 'retired'
  mailbox?: string
  /** Free-text over the obligation itself. */
  q?: string
  /**
   * Row order. Defaults to `newest`.
   *
   * ⚠ THE DEFAULT WAS `due` AND THE HEADER ABOVE CLAIMED OTHERWISE. This
   * module's own docstring has said "newest attention first" since it was
   * written, while `readOpenCommitments` ordered `created_at` ASCENDING —
   * oldest first. With 213 of 244 open rows carrying no date, the deadline key
   * decided almost nothing and the page was effectively oldest-first: anything
   * found this week sat at the bottom of a 244-row list. Richard's words on
   * 10-19 were that the ledger was "overwhelming to sift through", and this
   * was half of why.
   */
  sort?: CommitmentSort
}

export interface CommitmentListResult {
  items: CommitmentListItem[]
  /** Honest totals for the whole ledger, independent of the current filter. */
  totals: { open: number; quiet: number; settled: number; undated: number; retired: number }
  error: string | null
  withheld: number
}

/**
 * Resolve project and opportunity names in two batched reads.
 *
 * Both tables, always — §12: a uniqueness or ownership question against the
 * parallel-table split is always TWO questions, and a row naming an
 * opportunity would otherwise render with no record at all.
 */
async function resolveRecordNames(
  rows: { project_id: string | null; opportunity_id: string | null }[]
): Promise<Map<string, string>> {
  const db = sweepDb()
  const projectIds = [...new Set(rows.map((r) => r.project_id).filter((v): v is string => !!v))]
  const opportunityIds = [
    ...new Set(rows.map((r) => r.opportunity_id).filter((v): v is string => !!v)),
  ]

  const [projects, opportunities] = await Promise.all([
    projectIds.length
      ? db.from('projects').select('id, name').in('id', projectIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    opportunityIds.length
      ? db.from('opportunities').select('id, name').in('id', opportunityIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])

  const names = new Map<string, string>()
  for (const p of (projects.data ?? []) as { id: string; name: string }[]) names.set(p.id, p.name)
  for (const o of (opportunities.data ?? []) as { id: string; name: string }[]) names.set(o.id, o.name)
  return names
}

/**
 * The ledger's shape, for the counts above the list.
 *
 * ⚠ THE CONFIDENTIALITY FILTER APPLIES HERE TOO, AND IT DID NOT. These four
 * counts read the raw table while the list they head has protected rows removed
 * by `readOpenCommitments` — so the header said "527 open" over a list of 505
 * and the reader had no way to tell which number described what they could see.
 * The header comment called them "honest totals … independent of the current
 * filter", which was true of the VIEW filter and silently untrue of the
 * SECURITY filter, and those are not the same kind of independence.
 *
 * §12: a security filter belongs at the choke point as a default. This is not
 * the choke point, so it is applied the same way `readOpenCommitments` applies
 * it — in SQL, before the count — and it fails closed, because
 * `hiddenProjectIds(null)` enumerates every project if its own read fails.
 */
async function loadTotals(): Promise<CommitmentListResult['totals']> {
  const db = sweepDb()
  const today = new Date().toISOString().slice(0, 10)

  const hidden = await hiddenProjectIds(null)
  const exclude = notInList(hidden)
  /**
   * The exclusion, as one `.or()` arm set.
   *
   * `project_id.is.null` is required: an obligation filed on no record at all
   * has a NULL pointer, and §12 records that `.not.in` is NULL — and therefore
   * not true — for a NULL column, so without this arm every unfiled row would
   * vanish from the counts. 519 of 672 are unfiled.
   */
  const scoped = <T extends { or: (f: string) => T }>(q: T): T =>
    exclude ? q.or(`project_id.is.null,project_id.not.in.${exclude}`) : q

  const [open, quiet, settled, undated, retired] = await Promise.all([
    scoped(db.from('commitments').select('id', { count: 'exact', head: true }).eq('status', 'open')),
    scoped(
      db
        .from('commitments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .gt('snoozed_until', today)
    ),
    // ⚠ HUMAN statuses only, never `settled_at is not null`. The aging pass
    // closes stale rows as `resolved`, which is the machine state — counting
    // those here would make the one number that measures whether anybody is
    // working the ledger go up on its own. §12: two quantities, named apart.
    scoped(
      db
        .from('commitments')
        .select('id', { count: 'exact', head: true })
        .in('status', HUMAN_SETTLED)
    ),
    scoped(
      db
        .from('commitments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .is('due_date', null)
    ),
    // Closed by the aging pass specifically — NOT every `resolved` row. The
    // extractor also resolves rows (when a re-read of a grown thread no longer
    // claims them), and those are a different event the reader never asked
    // about. The reason string in `settled_by` is what tells them apart.
    scoped(
      db
        .from('commitments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'resolved')
        .like('settled_by', 'aged out —%')
    ),
  ])
  return {
    open: open.count ?? 0,
    quiet: quiet.count ?? 0,
    settled: settled.count ?? 0,
    undated: undated.count ?? 0,
    retired: retired.count ?? 0,
  }
}


/**
 * Apply the confidentiality filter to a history read, in memory.
 *
 * ⚠ IT WAS A COMMENT AND NOTHING ELSE. The settled branch carried the line
 * "It still applies the confidentiality filter, in memory — the set is small"
 * and applied none, returning `withheld: 0` over a completely unfiltered read —
 * so a protected project's settled obligations rendered on the page under a
 * disclosure that asserted nothing was hidden. §12: a workaround's recorded
 * reason must be re-tested before it is inherited, and a comment claiming a
 * control that is not there is worse than no comment at all.
 *
 * `readOpenCommitments` cannot serve these views: it is scoped to
 * `status='open'` by name. So the exclusion runs here, over a set bounded at
 * 300 — and `rows.length - visible.length` is an honest count in THIS case,
 * unlike at the choke point where it is structurally zero because the SQL
 * already removed them.
 */
async function withoutProtected<T extends { project_id: string | null }>(
  rows: T[]
): Promise<{ visible: T[]; withheld: number }> {
  const hidden = await hiddenProjectIds(null)
  if (hidden.size === 0) return { visible: rows, withheld: 0 }
  const visible = rows.filter((r) => !r.project_id || !hidden.has(r.project_id))
  return { visible, withheld: rows.length - visible.length }
}

export async function listCommitments(
  filters: CommitmentListFilters,
  authUserId: string | null
): Promise<CommitmentListResult> {
  const view = filters.view ?? 'open'
  const totals = await loadTotals()

  // The two history views are a different question from the live ledger and do
  // not go through readOpenCommitments, which is scoped to open rows by name.
  // Both apply the confidentiality filter through `withoutProtected` — read its
  // header before trusting any comment about that filter again.
  if (view === 'retired') {
    const { data, error } = await sweepDb()
      .from('commitments')
      .select('*, thread:email_threads(mailbox, last_at)')
      .eq('status', 'resolved')
      .like('settled_by', 'aged out —%')
      .order('settled_at', { ascending: false, nullsFirst: false })
      .limit(300)
    if (error) return { items: [], totals, error: error.message, withheld: 0 }
    const rows = (data ?? []) as (CommitmentRow & { thread: unknown })[]
    const { visible, withheld } = await withoutProtected(rows)
    const names = await resolveRecordNames(visible)
    return { items: visible.map((r) => shape(r, names)), totals, error: null, withheld }
  }

  if (view === 'settled') {
    const { data, error } = await sweepDb()
      .from('commitments')
      .select('*, thread:email_threads(mailbox, last_at)')
      .in('status', HUMAN_SETTLED)
      .order('settled_at', { ascending: false, nullsFirst: false })
      .limit(300)
    if (error) return { items: [], totals, error: error.message, withheld: 0 }
    const rows = (data ?? []) as (CommitmentRow & { thread: unknown })[]
    const { visible, withheld } = await withoutProtected(rows)
    const names = await resolveRecordNames(visible)
    return { items: visible.map((r) => shape(r, names)), totals, error: null, withheld }
  }

  const sort = filters.sort ?? 'newest'
  const { rows, error, withheld } = await readOpenCommitments({
    authUserId,
    // 'open' is the working view and hides what somebody deliberately quieted;
    // 'quiet' and 'all' both need the snoozed rows present.
    excludeSnoozed: view === 'open',
    side: filters.side,
    limit: 1000,
    sort,
  })
  if (error) return { items: [], totals, error, withheld }

  const today = new Date().toISOString().slice(0, 10)
  let filtered = rows
  if (view === 'quiet') {
    filtered = filtered.filter((r) => r.snoozed_until && r.snoozed_until > today)
  }
  if (filters.mailbox) filtered = filtered.filter((r) => r.mailbox === filters.mailbox)
  if (filters.q) {
    // Matched in memory rather than through `.or()`: the needle is user text,
    // and §12's rule is that an unescaped comma in a filter value parses as a
    // condition separator and kills the whole query silently. There is no
    // reason to risk it over a list already in hand.
    const needle = filters.q.toLowerCase()
    filtered = filtered.filter(
      (r) =>
        r.what.toLowerCase().includes(needle) ||
        (r.owner_name ?? '').toLowerCase().includes(needle)
    )
  }

  const names = await resolveRecordNames(filtered)
  const items = filtered.map((r) => shape(r, names))

  /**
   * `activity` is ordered HERE, not in SQL.
   *
   * The key lives on the embedded thread, and PostgREST will not reliably
   * order a filtered read by an embedded column — see the note on `applySort`.
   * The set is already bounded at 1000 and in hand, so sorting it costs
   * nothing and cannot be silently wrong about the order.
   *
   * Nulls last in both directions: a row whose thread carries no date is not
   * "the oldest conversation on file", it is one we cannot place, and §12's
   * rule is that a missing value must never be rendered as an extreme one.
   */
  if (sort === 'activity') {
    items.sort((a, b) => {
      if (!a.thread_last_at) return b.thread_last_at ? 1 : 0
      if (!b.thread_last_at) return -1
      return b.thread_last_at.localeCompare(a.thread_last_at)
    })
  }

  return { items, totals, error: null, withheld }
}

function shape(
  r: CommitmentRow & {
    mailbox?: string | null
    thread_last_at?: string | null
    thread?: unknown
  },
  names: Map<string, string>
): CommitmentListItem {
  const t = Array.isArray(r.thread) ? r.thread[0] : r.thread
  const embedded = t as { mailbox?: string; last_at?: string | null } | null
  const mailbox = r.mailbox ?? (embedded?.mailbox ?? null)
  return {
    id: r.id,
    what: r.what,
    side: r.side,
    status: r.status,
    owner_name: r.owner_name,
    due_date: r.due_date,
    created_at: r.created_at,
    snoozed_until: r.snoozed_until,
    project_id: r.project_id,
    opportunity_id: r.opportunity_id,
    record_name:
      (r.project_id ? names.get(r.project_id) : null) ??
      (r.opportunity_id ? names.get(r.opportunity_id) : null) ??
      null,
    mailbox,
    chase_text: r.chase_text,
    chase_drafted_at: r.chase_drafted_at,
    thread_last_at: r.thread_last_at ?? embedded?.last_at ?? null,
  }
}
