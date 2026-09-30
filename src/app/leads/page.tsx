import { Radar } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import {
  GMAIL_THREAD_EMBED,
  embeddedGmailThreadId,
  leadsDb,
  type LeadRow,
} from '@/lib/leads/db'
import LeadsClient from '@/components/leads/LeadsClient'
import type { AttachOption } from '@/components/leads/LeadDetailSheet'
import { listCategories } from '@/lib/leads/categories'
import { toCategoryViews } from '@/lib/leads/category-view'

export const metadata = { title: 'Leads — Ber Wilson Intelligence' }

/**
 * The inbound lead queue.
 *
 * Admin-only by default-deny — /leads is in no ROLE_PAGE_PREFIXES allowlist, so
 * the middleware already redirects every other role. This guard covers the case
 * where the allowlist later opens the page up without meaning to.
 */
export default async function LeadsPage({
  searchParams,
}: {
  /** ?lead=<id> opens that lead on mount — the target of the digest email's links. */
  searchParams: Promise<{ lead?: string }>
}) {
  const { lead: initialOpenLeadId } = await searchParams
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const db = leadsDb()

  // The taxonomy, shipped down as props. `listCategories` holds the service-role
  // client, so it is server-only and must not be reached from the client bundle
  // (§12); `toCategoryViews` drops the handoff addresses and Drive ids on the
  // way out, so the browser sees labels and tones and nothing operational.
  const categories = toCategoryViews(await listCategories())

  // Open queue plus everything triage rejected, in one trip. The client hides
  // the rejected rows behind a toggle; they're loaded so that toggle is instant
  // and so the count is honest.
  const [{ data: openRows, error }, { count: filteredCount }] = await Promise.all([
    db
      .from('leads')
      .select(`*, ${GMAIL_THREAD_EMBED}`)
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

  // Records a lead can be ATTACHED to instead of creating a new one. Read here
  // rather than behind a search endpoint: 15 projects and a handful of
  // opportunities is one small query, and a type-ahead that has to round-trip is
  // one the reader stops using.
  //
  // ⚠ Deliberately UNFILTERED on status. `.neq('status','archived')` looked like
  // the obvious hygiene and was two bugs at once: `project_status` has no
  // 'archived' member, so PostgREST failed the whole query with 22P02 and the
  // picker silently held opportunities only — and `projects.status` is nullable,
  // so even a valid value would have dropped every NULL-status row (§12). A
  // closed project is a legitimate thing to attach a late bid invitation to, and
  // the reader is picking by name from a type-ahead over fifteen records.
  const [{ data: projectRows, error: projectErr }, { data: opportunityRows }] = await Promise.all([
    db.from('projects').select('id, name').order('name').limit(500),
    db.from('opportunities').select('id, name').order('name').limit(500),
  ])
  // A picker that quietly holds half the records is worse than one that is
  // obviously empty, so say so rather than rendering a shorter list.
  if (projectErr) console.error('[leads] could not load attach targets:', projectErr.message)
  const attachOptions: AttachOption[] = [
    ...((projectRows ?? []) as { id: string; name: string }[]).map((r) => ({
      id: r.id,
      name: r.name,
      kind: 'project' as const,
    })),
    ...((opportunityRows ?? []) as { id: string; name: string }[]).map((r) => ({
      id: r.id,
      name: r.name,
      kind: 'opportunity' as const,
    })),
  ]

  const { data: filteredRows } = await db
    .from('leads')
    .select(`*, ${GMAIL_THREAD_EMBED}`)
    .eq('status', 'spam')
    .order('received_at', { ascending: false })
    .limit(200)

  // Flatten Gmail's conversation id up onto the row. The detail sheet links
  // straight into the mailbox, and it cannot use `thread_id` for that — that is
  // this platform's UUID, which Gmail does not recognise.
  const flatten = (rows: unknown[] | null): LeadRow[] =>
    ((rows ?? []) as LeadRow[]).map((r) => ({ ...r, gmail_thread_id: embeddedGmailThreadId(r) }))

  const leads = [...flatten(openRows), ...flatten(filteredRows)]

  // A deep-linked lead that fell outside the windows above, fetched by id.
  //
  // ⚠ The queue is capped at 300 and ordered by bid date then fit score, both
  // nullsFirst:false — so a lead with NEITHER sorts dead last and is the first
  // thing the cap drops. That is exactly the shape of a freshly staged meeting
  // lead, and of anything not yet scored: the sheet would simply never open,
  // silently, for the one lead the link was about. The digest email's links have
  // the same exposure whenever the queue is long.
  if (initialOpenLeadId && !leads.some((l) => l.id === initialOpenLeadId)) {
    const { data: deepRow } = await db
      .from('leads')
      .select(`*, ${GMAIL_THREAD_EMBED}`)
      .eq('id', initialOpenLeadId)
      .maybeSingle()
    if (deepRow) leads.unshift(...flatten([deepRow]))
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Radar className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Bid invitations arriving at info@ and deals submitted through the website form, read
            and scored against what Ber Wilson actually pursues. Each lead is sorted into a line
            of business, which decides where it goes: a project, an opportunity, a steel deal, a
            handoff to the trade that does the work — or attached to the record it already
            belongs to.
          </p>
        </div>
      </div>

      <LeadsClient
        initialOpenLeadId={initialOpenLeadId ?? null}
        initialLeads={leads}
        filteredCount={filteredCount ?? 0}
        attachOptions={attachOptions}
        categories={categories}
      />
    </div>
  )
}
