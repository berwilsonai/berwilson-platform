import { Suspense } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ReviewQueueItem, MentionedParty } from '@/types/domain'
import ReviewItem from '@/components/review/ReviewItem'

export const metadata = { title: 'Review Queue — Ber Wilson Intelligence' }
import ReviewFilters from '@/components/review/ReviewFilters'
import EmptyState from '@/components/shared/EmptyState'

interface PageProps {
  searchParams: Promise<{ project_id?: string; reason?: string; show_resolved?: string }>
}

const VALID_REASONS = ['low_confidence', 'ambiguous_project', 'unknown_party', 'conflicting_data']

export default async function ReviewPage({ searchParams }: PageProps) {
  const params = await searchParams
  const projectId = params.project_id ?? ''
  const reason = VALID_REASONS.includes(params.reason ?? '') ? (params.reason ?? '') : ''
  const showResolved = params.show_resolved === '1'

  const supabase = createAdminClient()

  // Fetch items with project join; when showResolved, include resolved items too
  let query = supabase
    .from('review_queue')
    .select('*, project:projects(id, name, sector, status)')
    .order('resolved_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })

  if (!showResolved) query = query.is('resolved_at', null)
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
  const pendingCount = reviewItems.filter((i) => !i.resolved_at).length
  const count = reviewItems.length
  const hasFilters = projectId || reason

  // Batch-fetch mentioned_parties for all update-type review items
  const updateIds = reviewItems
    .filter((i) => i.source_table === 'updates')
    .map((i) => i.record_id)

  const mentionedPartiesMap: Record<string, MentionedParty[]> = {}
  if (updateIds.length > 0) {
    const { data: updateData } = await supabase
      .from('updates')
      .select('id, mentioned_parties')
      .in('id', updateIds)

    for (const u of updateData ?? []) {
      const parties = u.mentioned_parties
      if (Array.isArray(parties) && parties.length > 0) {
        mentionedPartiesMap[u.id] = parties as MentionedParty[]
      }
    }
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Suspense>
            <ReviewFilters
              projects={projects}
              projectId={projectId}
              reason={reason}
              showResolved={showResolved}
            />
          </Suspense>
          {count > 0 && (
            <span className="text-xs text-muted-foreground">
              {showResolved
                ? `${pendingCount} pending, ${count - pendingCount} resolved${hasFilters ? ' (filtered)' : ''}`
                : `${count} item${count !== 1 ? 's' : ''} pending${hasFilters ? ' (filtered)' : ''}`}
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
            <ReviewItem
              key={item.id}
              item={item}
              allProjects={projects}
              mentionedParties={mentionedPartiesMap[item.record_id] ?? []}
              showResolved={showResolved}
            />
          ))}
        </div>
      )}
    </div>
  )
}
