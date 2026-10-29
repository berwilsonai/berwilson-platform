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

/**
 * How many rows reach the dashboard rail.
 *
 * ⚠ WAS 24, AND 24 ROWS IS NOT A PANEL — it is a page in a sticky column, and
 * it buried everything under it. Measured 10-29: the rail rendered 24
 * commitments above the attention card, which on a 1512×2513 render put the
 * attention rail entirely below the fold of a 2600px window.
 *
 * ⚠ AND THE OLD CAP WAS BEING READ AS A COUNT. The panel's section headers
 * print `list.length`, so with the slice capped at 24 they read "WE OWE 5" and
 * "WAITING ON 19" against a table holding 71 and 127 open — a display cap
 * inventing a quantity, which is the §12 failure this same rail's attention
 * card was rebuilt to remove on the same day. The counts now come from SQL and
 * travel beside the rows.
 */
const PER_SIDE = 4

export interface OpenCommitments {
  items: CommitmentItem[]
  /** TRUE open counts per side — never `items.length`. */
  counts: { us: number; them: number }
}

const EMPTY: OpenCommitments = { items: [], counts: { us: 0, them: 0 } }

export async function loadOpenCommitments(): Promise<OpenCommitments> {
  const db = sweepDb()

  // Never throws. A dashboard that 500s because one panel's table is missing
  // is a far worse outcome than a dashboard with one panel absent — and this
  // table post-dates several deploys, so a pre-migration app must still render.
  /*
    ⚠ ONE QUERY PER SIDE, NOT ONE LIMIT OVER BOTH.

    A single `.limit()` across both sides is ordered by due date, so whichever
    side holds the soonest dates takes the whole slice — measured 10-29, the
    six-row cut was six `them` rows and the "We owe" section did not render AT
    ALL, on a ledger with 71 open commitments on our own side. A panel that can
    silently drop a whole half is worse than one that shows fewer of each.
  */
  const side = (which: 'us' | 'them') =>
    db
      .from('commitments')
      .select(
        'id, what, side, owner_name, due_date, created_at, project_id, opportunity_id, status'
      )
      .eq('status', 'open')
      .eq('side', which)
      // Dated first, soonest first; undated fall to the bottom in arrival order.
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(PER_SIDE)

  const [us, them] = await Promise.all([side('us'), side('them')])

  if ((us.error && them.error) || (!us.data && !them.data)) {
    const err = us.error ?? them.error
    if (err) console.warn('[commitments] could not load:', err.message)
    return EMPTY
  }

  const rows = [...((us.data ?? []) as CommitmentRow[]), ...((them.data ?? []) as CommitmentRow[])]

  /*
    The true totals, as head counts in SQL.

    ⚠ A COUNT IS AN AGGREGATE AND CANNOT BE DERIVED FROM A LIMITED LIST (§12) —
    `rows.filter(...).length` is capped by LIMIT above by construction, which is
    exactly how the header came to under-report by 11x. Two cheap counts.
  */
  const [{ count: usCount }, { count: themCount }] = await Promise.all([
    db.from('commitments').select('id', { count: 'exact', head: true }).eq('status', 'open').eq('side', 'us'),
    db.from('commitments').select('id', { count: 'exact', head: true }).eq('status', 'open').eq('side', 'them'),
  ])
  const counts = { us: usCount ?? 0, them: themCount ?? 0 }

  if (rows.length === 0) return { items: [], counts }

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

  const items = rows.map((r) => ({
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

  return { items, counts }
}
