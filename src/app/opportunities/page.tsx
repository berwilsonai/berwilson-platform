import { PageHeader } from '@/components/ui/page-header'
import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, Lightbulb } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import {
  OPPORTUNITY_TYPES,
  OPPORTUNITY_STATUSES,
  type OpportunityType,
  type OpportunityStatus,
} from '@/lib/utils/opportunities'
import EmptyState from '@/components/shared/EmptyState'
import OpportunityFilters from '@/components/opportunities/OpportunityFilters'
import OpportunitiesClient from '@/components/opportunities/OpportunitiesClient'

export const metadata = { title: 'Opportunities — Ber Wilson Intelligence' }

interface PageProps {
  searchParams: Promise<{ type?: string; status?: string }>
}

export default async function OpportunitiesPage({ searchParams }: PageProps) {
  const params = await searchParams
  const type = OPPORTUNITY_TYPES.includes(params.type as OpportunityType)
    ? (params.type as OpportunityType)
    : ''
  const status = OPPORTUNITY_STATUSES.includes(params.status as OpportunityStatus)
    ? (params.status as OpportunityStatus)
    : ''

  const supabase = createAdminClient()

  let query = supabase
    .from('opportunities')
    .select('*')
    .order('updated_at', { ascending: false })

  if (type) query = query.eq('opp_type', type)
  if (status) query = query.eq('status', status)

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to load opportunities: ${error.message}`)
  }

  // Non-admins only see granted opportunities.
  const viewer = await getViewer()
  const isAdmin = viewer?.isAdmin ?? true
  const opportunities = isAdmin
    ? data
    : (data ?? []).filter((o) => viewer!.grantedOpportunityIds.includes(o.id))

  const count = opportunities?.length ?? 0
  const hasFilters = type || status

  return (
    <div className="space-y-5">
      {/*
        ⚠ THIS PAGE HAD NO MASTHEAD AT ALL until 2026-10-27 — it opened on a
        filter row, and the only thing naming it was the 14.5px locator in the
        app header. /investors was the same. A page with no title is the
        clearest case there is for one owner (§5.1).
      */}
      <PageHeader
        icon={Lightbulb}
        title="Opportunities"
        description="Acquisitions, partnerships, JVs and other strategic positions — tracked before they are projects, with the same child records a project carries."
        className="mb-0"
        actions={
          isAdmin ? (
            <Link
              href="/opportunities/new"
              className="inline-flex shrink-0 items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary elev-1 text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90"
            >
              <Plus size={14} />
              New Opportunity
            </Link>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Suspense>
            <OpportunityFilters type={type} status={status} />
          </Suspense>
          {count > 0 && (
            <span className="tnum text-xs text-muted-foreground">
              {count} {count !== 1 ? 'opportunities' : 'opportunity'}
              {hasFilters ? ' matching' : ''}
            </span>
          )}
        </div>
      </PageHeader>

      {/* Cards grid or empty state */}
      {count === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title={hasFilters ? 'No opportunities match these filters' : 'No opportunities yet'}
          description={
            hasFilters
              ? 'Try adjusting the filters above.'
              : 'Track acquisitions, partnerships, JVs, and other strategic opportunities here.'
          }
          action={
            !hasFilters ? (
              <Link
                href="/opportunities/new"
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary elev-1 text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={14} />
                New Opportunity
              </Link>
            ) : undefined
          }
        />
      ) : (
        <OpportunitiesClient opportunities={opportunities ?? []} canDelete={isAdmin} />
      )}
    </div>
  )
}
