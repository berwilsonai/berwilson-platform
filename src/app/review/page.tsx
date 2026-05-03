import { Suspense } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ReviewQueueItem, MentionedParty, PartyMatchResult } from '@/types/domain'
import ReviewItem from '@/components/review/ReviewItem'

export const metadata = { title: 'Review Queue — Ber Wilson Intelligence' }
import ReviewFilters from '@/components/review/ReviewFilters'
import EmptyState from '@/components/shared/EmptyState'

interface PageProps {
  searchParams: Promise<{ project_id?: string; reason?: string; show_resolved?: string }>
}

const VALID_REASONS = ['low_confidence', 'ambiguous_project', 'unknown_party', 'conflicting_data']

// ---------------------------------------------------------------------------
// Name matching helpers
// ---------------------------------------------------------------------------

interface SimpleParty { id: string; full_name: string; email: string | null }
interface SimpleAlias { alias: string; party_id: string }

function matchMentionedParty(
  mention: MentionedParty,
  parties: SimpleParty[],
  aliases: SimpleAlias[],
): PartyMatchResult {
  const name = mention.name.toLowerCase().trim()

  // 1. Saved alias match (highest priority — user already confirmed this)
  const aliasMatch = aliases.find((a) => a.alias === name)
  if (aliasMatch) {
    const party = parties.find((p) => p.id === aliasMatch.party_id)
    if (party) return { ...mention, matchedPartyId: party.id, matchedPartyName: party.full_name }
  }

  // 2. Exact full-name match
  const exact = parties.find((p) => p.full_name.toLowerCase() === name)
  if (exact) return { ...mention, matchedPartyId: exact.id, matchedPartyName: exact.full_name }

  // 3. Single-word (first name only) match — only if exactly one party matches
  if (!name.includes(' ')) {
    const firstNameMatches = parties.filter(
      (p) => p.full_name.toLowerCase().split(' ')[0] === name
    )
    if (firstNameMatches.length === 1) {
      return { ...mention, matchedPartyId: firstNameMatches[0].id, matchedPartyName: firstNameMatches[0].full_name }
    }
  }

  return mention // no match found
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ReviewPage({ searchParams }: PageProps) {
  const params = await searchParams
  const projectId = params.project_id ?? ''
  const reason = VALID_REASONS.includes(params.reason ?? '') ? (params.reason ?? '') : ''
  const showResolved = params.show_resolved === '1'

  const supabase = createAdminClient()

  // Fetch review queue items with project join
  let query = supabase
    .from('review_queue')
    .select('*, project:projects(id, name, sector, status)')
    .order('resolved_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })

  if (!showResolved) query = query.is('resolved_at', null)
  if (projectId) query = query.eq('project_id', projectId)
  if (reason) query = query.eq('reason', reason)

  const [
    { data: items, error },
    { data: allProjects },
    { data: allParties },
    { data: allAliases },
  ] = await Promise.all([
    query,
    supabase.from('projects').select('id, name').order('name', { ascending: true }),
    supabase.from('parties').select('id, full_name, email').order('full_name', { ascending: true }),
    // contact_aliases is a new table not yet in generated types — cast to allow the query
    (supabase as unknown as import('@supabase/supabase-js').SupabaseClient)
      .from('contact_aliases')
      .select('alias, party_id'),
  ])

  if (error) {
    throw new Error(`Failed to load review queue: ${error.message}`)
  }

  const reviewItems = (items ?? []) as ReviewQueueItem[]
  const projects = allProjects ?? []
  const parties = (allParties ?? []) as SimpleParty[]
  const aliases = (allAliases ?? []) as unknown as SimpleAlias[]
  const pendingCount = reviewItems.filter((i) => !i.resolved_at).length
  const count = reviewItems.length
  const hasFilters = projectId || reason

  // Batch-fetch mentioned_parties for all update-type review items
  const updateIds = reviewItems
    .filter((i) => i.source_table === 'updates')
    .map((i) => i.record_id)

  const matchedPartiesMap: Record<string, PartyMatchResult[]> = {}
  if (updateIds.length > 0) {
    const { data: updateData } = await supabase
      .from('updates')
      .select('id, mentioned_parties')
      .in('id', updateIds)

    for (const u of updateData ?? []) {
      const rawParties = u.mentioned_parties
      if (Array.isArray(rawParties) && rawParties.length > 0) {
        matchedPartiesMap[u.id] = (rawParties as MentionedParty[]).map((p) =>
          matchMentionedParty(p, parties, aliases)
        )
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
              allParties={parties}
              matchedParties={matchedPartiesMap[item.record_id] ?? []}
              showResolved={showResolved}
            />
          ))}
        </div>
      )}
    </div>
  )
}
