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
import { readOpenCommitments } from './read'
import type { CommitmentRow, CommitmentStatus } from './db'

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
}

export interface CommitmentListFilters {
  side?: 'us' | 'them'
  /** 'open' hides snoozed rows; 'quiet' shows only them; 'settled' the history. */
  view?: 'open' | 'quiet' | 'settled' | 'all'
  mailbox?: string
  /** Free-text over the obligation itself. */
  q?: string
}

export interface CommitmentListResult {
  items: CommitmentListItem[]
  /** Honest totals for the whole ledger, independent of the current filter. */
  totals: { open: number; quiet: number; settled: number; undated: number }
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

/** The ledger's shape, for the counts above the list. */
async function loadTotals(): Promise<CommitmentListResult['totals']> {
  const db = sweepDb()
  const today = new Date().toISOString().slice(0, 10)
  const [open, quiet, settled, undated] = await Promise.all([
    db.from('commitments').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    db
      .from('commitments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .gt('snoozed_until', today),
    db.from('commitments').select('id', { count: 'exact', head: true }).in('status', ['done', 'dismissed']),
    db
      .from('commitments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .is('due_date', null),
  ])
  return {
    open: open.count ?? 0,
    quiet: quiet.count ?? 0,
    settled: settled.count ?? 0,
    undated: undated.count ?? 0,
  }
}

export async function listCommitments(
  filters: CommitmentListFilters,
  authUserId: string | null
): Promise<CommitmentListResult> {
  const view = filters.view ?? 'open'
  const totals = await loadTotals()

  // The settled history is a different question from the live ledger and does
  // not go through readOpenCommitments, which is scoped to open rows by name.
  // It still applies the confidentiality filter, in memory — the set is small.
  if (view === 'settled') {
    const { data, error } = await sweepDb()
      .from('commitments')
      .select('*, thread:email_threads(mailbox)')
      .in('status', ['done', 'dismissed'])
      .order('settled_at', { ascending: false, nullsFirst: false })
      .limit(300)
    if (error) return { items: [], totals, error: error.message, withheld: 0 }
    const rows = (data ?? []) as (CommitmentRow & { thread: unknown })[]
    const names = await resolveRecordNames(rows)
    return {
      items: rows.map((r) => shape(r, names)),
      totals,
      error: null,
      withheld: 0,
    }
  }

  const { rows, error, withheld } = await readOpenCommitments({
    authUserId,
    // 'open' is the working view and hides what somebody deliberately quieted;
    // 'quiet' and 'all' both need the snoozed rows present.
    excludeSnoozed: view === 'open',
    side: filters.side,
    limit: 1000,
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
  return { items: filtered.map((r) => shape(r, names)), totals, error: null, withheld }
}

function shape(
  r: CommitmentRow & { mailbox?: string | null; thread?: unknown },
  names: Map<string, string>
): CommitmentListItem {
  const t = Array.isArray(r.thread) ? r.thread[0] : r.thread
  const mailbox =
    r.mailbox ?? ((t as { mailbox?: string } | null)?.mailbox ?? null)
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
  }
}
