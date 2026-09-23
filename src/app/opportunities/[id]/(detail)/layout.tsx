import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canAccessOpportunity } from '@/lib/auth/viewer'
import { cn } from '@/lib/utils'
import {
  oppType,
  oppStatus,
  oppPriority,
  isClosedStatus,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_TYPE_BADGE,
  OPPORTUNITY_PRIORITY_LABELS,
  OPPORTUNITY_PRIORITY_BADGE,
  OPPORTUNITY_PIPELINE,
  OPPORTUNITY_STATUS_INDEX,
  OPPORTUNITY_STATUS_LABELS,
} from '@/lib/utils/opportunities'
import OpportunityStatusControl from '@/components/opportunities/OpportunityStatusControl'
import GenerateBriefButton from '@/components/projects/GenerateBriefButton'
import OpportunityDeleteButton from '@/components/opportunities/OpportunityDeleteButton'
import RecordTabBar, { type TabKey } from '@/components/records/RecordTabBar'
import { OPPORTUNITY_TABS } from '@/components/records/tabs'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

/**
 * An opportunity is a record with the same children a project has — players,
 * documents, milestones, diligence, financing, entities — so it gets the same
 * shell: one header with the deal's identity and controls, and a tab bar that
 * only shows what the deal actually holds.
 *
 * The brief print view deliberately sits OUTSIDE this route group, so a
 * document carried into a meeting doesn't come out with a tab bar on it.
 */
export default async function OpportunityDetailLayout({ children, params }: LayoutProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: opportunity } = await supabase
    .from('opportunities')
    .select('id, name, target_name, opp_type, status, priority')
    .eq('id', id)
    .single()

  if (!opportunity) notFound()

  // Grant check — non-admins only reach opportunities they've been granted.
  // 404 rather than 403: don't confirm the record exists.
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin && !canAccessOpportunity(viewer, id)) notFound()

  // Which tabs actually hold anything — head counts on indexed columns, run in
  // parallel, so the rows are never fetched.
  const count = async (
    table: 'project_players' | 'opportunity_notes' | 'meetings' | 'tasks'
      | 'opportunity_documents' | 'milestones' | 'financing_structures' | 'dd_items' | 'entity_projects'
  ) => {
    const { count: n } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('opportunity_id', id)
    return n ?? 0
  }
  const [players, notes, meetings, tasks, documents, milestones, financing, diligence, entities] =
    await Promise.all([
      count('project_players'), count('opportunity_notes'), count('meetings'), count('tasks'),
      count('opportunity_documents'), count('milestones'), count('financing_structures'),
      count('dd_items'), count('entity_projects'),
    ])
  const tabCounts: Partial<Record<TabKey, number>> = {
    players, updates: notes, meetings, tasks, documents, milestones, financing, diligence, entities,
  }

  const t = oppType(opportunity.opp_type)
  const s = oppStatus(opportunity.status)
  const p = oppPriority(opportunity.priority)
  const closed = isClosedStatus(opportunity.status)
  const onHold = s === 'on_hold'
  const currentIndex = OPPORTUNITY_STATUS_INDEX[s]

  return (
    <div className="space-y-0">
      <div className="pb-5 space-y-3">
        <nav className="flex items-center gap-1.5 text-sm">
          <Link href="/opportunities" className="text-muted-foreground hover:text-foreground transition-colors">
            Opportunities
          </Link>
          <span className="text-muted-foreground/50">/</span>
          <span className="text-foreground font-medium truncate max-w-[300px]">{opportunity.name}</span>
        </nav>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', OPPORTUNITY_TYPE_BADGE[t])}>
                {OPPORTUNITY_TYPE_LABELS[t]}
              </span>
              <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', OPPORTUNITY_PRIORITY_BADGE[p])}>
                {OPPORTUNITY_PRIORITY_LABELS[p]} priority
              </span>
            </div>
            <h1 className="text-xl font-semibold leading-tight">{opportunity.name}</h1>
            {opportunity.target_name && (
              <p className="text-sm text-muted-foreground">{opportunity.target_name}</p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <GenerateBriefButton recordId={id} recordName={opportunity.name} kind="opportunity" />
            <OpportunityStatusControl opportunityId={id} status={s} />
            <Link
              href={`/opportunities/${id}/edit`}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
            >
              <Pencil size={13} />
              Edit
            </Link>
            <OpportunityDeleteButton opportunityId={id} name={opportunity.name} />
          </div>
        </div>

        {/* Pipeline progress */}
        {!closed && !onHold && (
          <div className="flex items-center gap-1">
            {OPPORTUNITY_PIPELINE.map((stage, i) => (
              <div key={stage} className="flex-1 min-w-0">
                <div
                  className={cn(
                    'h-1.5 rounded-full transition-colors',
                    i <= currentIndex ? 'bg-primary' : 'bg-muted'
                  )}
                />
                <span
                  className={cn(
                    'mt-1 block text-[10px] truncate',
                    i === currentIndex ? 'text-foreground font-medium' : 'text-muted-foreground'
                  )}
                >
                  {OPPORTUNITY_STATUS_LABELS[stage]}
                </span>
              </div>
            ))}
          </div>
        )}
        {onHold && (
          <div className="rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
            On Hold
          </div>
        )}
        {closed && (
          <div className={cn(
            'rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset',
            opportunity.status === 'closed_won'
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30'
              : 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30'
          )}>
            {OPPORTUNITY_STATUS_LABELS[s]}
          </div>
        )}
      </div>

      <RecordTabBar basePath={`/opportunities/${id}`} tabs={OPPORTUNITY_TABS} counts={tabCounts} />

      <div className="pt-6">{children}</div>
    </div>
  )
}
