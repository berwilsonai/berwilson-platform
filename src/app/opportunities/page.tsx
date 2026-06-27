import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, Lightbulb } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
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

  const { data: opportunities, error } = await query

  if (error) {
    throw new Error(`Failed to load opportunities: ${error.message}`)
  }

  const count = opportunities?.length ?? 0
  const hasFilters = type || status

  return (
    <div className="space-y-5">
      {/* Page toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Suspense>
            <OpportunityFilters type={type} status={status} />
          </Suspense>
          {count > 0 && (
            <span className="text-xs text-muted-foreground">
              {count} {count !== 1 ? 'opportunities' : 'opportunity'}
              {hasFilters ? ' matching' : ''}
            </span>
          )}
        </div>
        <Link
          href="/opportunities/new"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus size={14} />
          New Opportunity
        </Link>
      </div>

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
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={14} />
                New Opportunity
              </Link>
            ) : undefined
          }
        />
      ) : (
        <OpportunitiesClient opportunities={opportunities ?? []} />
      )}
    </div>
  )
}
