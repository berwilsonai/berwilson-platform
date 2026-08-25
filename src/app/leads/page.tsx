import { Radar } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import { leadsDb, type LeadRow } from '@/lib/leads/db'
import LeadsClient from '@/components/leads/LeadsClient'

export const metadata = { title: 'Leads — Ber Wilson Intelligence' }

/**
 * The inbound lead queue.
 *
 * Admin-only by default-deny — /leads is in no ROLE_PAGE_PREFIXES allowlist, so
 * the middleware already redirects every other role. This guard covers the case
 * where the allowlist later opens the page up without meaning to.
 */
export default async function LeadsPage() {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const db = leadsDb()

  // Open queue plus everything triage rejected, in one trip. The client hides
  // the rejected rows behind a toggle; they're loaded so that toggle is instant
  // and so the count is honest.
  const [{ data: openRows, error }, { count: filteredCount }] = await Promise.all([
    db
      .from('leads')
      .select('*')
      .neq('status', 'spam')
      .order('bid_due_date', { ascending: true, nullsFirst: false })
      .order('fit_score', { ascending: false, nullsFirst: false })
      .limit(300),
    db.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'spam'),
  ])

  if (error) {
    throw new Error(
      `Failed to load leads: ${error.message}. If this mentions a missing table, the leads migration has not been applied.`
    )
  }

  const { data: filteredRows } = await db
    .from('leads')
    .select('*')
    .eq('status', 'spam')
    .order('received_at', { ascending: false })
    .limit(200)

  const leads = [...((openRows ?? []) as LeadRow[]), ...((filteredRows ?? []) as LeadRow[])]

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Radar className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Bid invitations and enquiries arriving at info@, read and scored against what Ber Wilson
            actually pursues. Promote one and it becomes a project, an opportunity, or a steel deal.
          </p>
        </div>
      </div>

      <LeadsClient initialLeads={leads} filteredCount={filteredCount ?? 0} />
    </div>
  )
}
