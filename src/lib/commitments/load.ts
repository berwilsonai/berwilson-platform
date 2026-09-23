/**
 * Read the open commitments for the dashboard panel.
 *
 * Server-side, so the panel is correct on first paint rather than popping in
 * after a fetch — and so the record names are resolved once here instead of
 * per row in the browser.
 */

import { sweepDb } from '@/lib/email-sweep/db'
import type { CommitmentItem } from '@/components/dashboard/Commitments'
import type { CommitmentRow } from './db'

/** Undated commitments are shown too, but the panel stays a panel, not a page. */
const LIMIT = 24

export async function loadOpenCommitments(): Promise<CommitmentItem[]> {
  const db = sweepDb()

  // Never throws. A dashboard that 500s because one panel's table is missing
  // is a far worse outcome than a dashboard with one panel absent — and this
  // table post-dates several deploys, so a pre-migration app must still render.
  const { data, error } = await db
    .from('commitments')
    .select(
      'id, what, side, owner_name, due_date, created_at, project_id, opportunity_id, status'
    )
    .eq('status', 'open')
    // Dated first, soonest first; undated fall to the bottom in arrival order.
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(LIMIT)

  if (error || !data) {
    if (error) console.warn('[commitments] could not load:', error.message)
    return []
  }

  const rows = data as CommitmentRow[]
  if (rows.length === 0) return []

  // Resolve record names in two batched reads rather than one per row.
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

  return rows.map((r) => ({
    id: r.id,
    what: r.what,
    side: r.side,
    owner_name: r.owner_name,
    due_date: r.due_date,
    created_at: r.created_at,
    project_id: r.project_id,
    opportunity_id: r.opportunity_id,
    record_name: names.get(r.project_id ?? r.opportunity_id ?? '') ?? null,
  }))
}
