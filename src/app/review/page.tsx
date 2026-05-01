import { Suspense } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ReviewQueueItem } from '@/types/domain'
import ReviewItem from '@/components/review/ReviewItem'

export const metadata = { title: 'Review Queue — Ber Wilson Intelligence' }
import ReviewFilters from '@/components/review/ReviewFilters'
import EmptyState from '@/components/shared/EmptyState'

interface PageProps {
  searchParams: Promise<{ project_id?: string; reason?: string }>
}

const VALID_REASONS = ['low_confidence', 'ambiguous_project', 'unknown_party', 'conflicting_data']

export default async function ReviewPage({ searchParams }: PageProps) {
  const params = await searchParams
  const projectId = params.project_id ?? ''
  const reason = VALID_REASONS.includes(params.reason ?? '') ? (params.reason ?? '') : ''

  const supabase = createAdminClient()

  // Fetch pending items with project join
  let query = supabase
    .from('review_queue')
    .select('*, project:projects(id, name, sector, status)')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })

  if (projectId) query = query.eq('project_id', projectId)
  if (reason) query = query.eq('reason', reason)

  const [{ data: items, error }, { data: allProjects }] = await Promise.all([
    query,
    supabase
      .from('projects')
      .select('id, name')
      .order('name', { ascending: true }),
  ])

  if (error) {
    throw new Error(`Failed to load review queue: ${error.message}`)
  }

  const reviewItems = (items ?? []) as ReviewQueueItem[]
  const projects = allProjects ?? []
  const count = reviewItems.length
  const hasFilters = projectId || reason

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Suspense>
            <ReviewFilters projects={projects} projectId={projectId} reason={reason} />
          </Suspense>
          {count > 0 && (
            <span className="text-xs text-muted-foreground">
              {count} item{count !== 1 ? 's' : ''} pending{hasFilters ? ' (filtered)' : ''}
            </span>
          )}
        </div>
      </div>

      {/* List or empty state */}
      {count === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={hasFilters ? 'No items match these filters' : 'Queue is clear'}
          description={
            hasFilters
              ? 'Try adjusting the filters above.'
              : 'All extractions have been reviewed. New low-confidence items will appear here automatically.'
          }
        />
      ) : (
        <div className="space-y-3">
          {reviewItems.map((item) => (
            <ReviewItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
