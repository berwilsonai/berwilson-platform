/**
 * GET /api/eval/report?days=30
 *
 * Returns 4 evaluation metrics for the given window (default 30 days):
 * 1. extraction_accuracy — % of review items approved without edit
 * 2. review_throughput   — avg hours from created to resolved
 * 3. agent_satisfaction  — % thumbs-up across ai_queries + agent_messages
 * 4. extraction_errors   — which fields get corrected most often
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const days = Math.min(365, Math.max(1, parseInt(request.nextUrl.searchParams.get('days') ?? '30', 10) || 30))
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const admin = createAdminClient()

  type ReviewRow = { resolution: string | null; resolved_at: string | null; created_at: string; edit_diff: Record<string, unknown> | null }

  // 1 & 2 & 4: Review queue — cast because edit_diff column is new (run migration + gen-types to clean up)
  const { data: reviewRows } = await (admin as unknown as import('@supabase/supabase-js').SupabaseClient)
    .from('review_queue' as never)
    .select('resolution, resolved_at, created_at, edit_diff')
    .not('resolved_at', 'is', null)
    .gte('resolved_at', since)

  const rows = (reviewRows ?? []) as ReviewRow[]
  const totalResolved = rows.length
  const approvedAsIs = rows.filter(r => r.resolution === 'approved').length
  const edited = rows.filter(r => r.resolution === 'edited').length
  const rejected = rows.filter(r => r.resolution === 'rejected').length

  const extractionAccuracy = totalResolved > 0
    ? Math.round((approvedAsIs / totalResolved) * 1000) / 10
    : null

  const resolvedWithTime = rows.filter(r => r.resolved_at && r.created_at)
  const avgHours = resolvedWithTime.length > 0
    ? Math.round(
        resolvedWithTime.reduce((sum, r) => {
          const ms = new Date(r.resolved_at!).getTime() - new Date(r.created_at).getTime()
          return sum + ms / 3_600_000
        }, 0) / resolvedWithTime.length * 10
      ) / 10
    : null

  // 4. Extraction errors: count which fields were changed in edit_diffs
  const fieldCounts: Record<string, number> = {
    summary: 0,
    action_items: 0,
    waiting_on: 0,
    risks: 0,
    decisions: 0,
  }

  for (const r of rows) {
    if (!r.edit_diff) continue
    const diff = r.edit_diff as Record<string, unknown>
    if (diff.summary) fieldCounts.summary++
    if ((diff.action_items as { changed?: boolean } | undefined)?.changed) fieldCounts.action_items++
    if ((diff.waiting_on as { changed?: boolean } | undefined)?.changed) fieldCounts.waiting_on++
    if ((diff.risks as { changed?: boolean } | undefined)?.changed) fieldCounts.risks++
    if ((diff.decisions as { changed?: boolean } | undefined)?.changed) fieldCounts.decisions++
  }

  const extractionErrors = Object.entries(fieldCounts)
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count)

  // 3. Agent satisfaction: ai_queries + agent_messages
  type RatingRow = { rating: number | null }
  // Both rating columns are new — cast until gen-types is re-run
  const sc = admin as unknown as import('@supabase/supabase-js').SupabaseClient
  const [{ data: queryRatings }, { data: msgRatings }] = await Promise.all([
    sc.from('ai_queries' as never).select('rating').not('rating', 'is', null).gte('created_at', since),
    sc.from('agent_messages' as never).select('rating').not('rating', 'is', null).gte('created_at', since),
  ])

  const allRatings: RatingRow[] = [
    ...((queryRatings ?? []) as RatingRow[]),
    ...((msgRatings ?? []) as RatingRow[]),
  ]
  const totalRated = allRatings.length
  const thumbsUp = allRatings.filter(r => r.rating === 1).length
  const thumbsDown = allRatings.filter(r => r.rating === -1).length
  const agentSatisfaction = totalRated > 0
    ? Math.round((thumbsUp / totalRated) * 1000) / 10
    : null

  return NextResponse.json({
    window_days: days,
    since,
    extraction_accuracy: {
      pct_approved_without_edit: extractionAccuracy,
      total_resolved: totalResolved,
      approved_as_is: approvedAsIs,
      edited,
      rejected,
    },
    review_throughput: {
      avg_hours_to_resolve: avgHours,
      sample_size: resolvedWithTime.length,
    },
    agent_satisfaction: {
      pct_thumbs_up: agentSatisfaction,
      total_rated: totalRated,
      thumbs_up: thumbsUp,
      thumbs_down: thumbsDown,
    },
    extraction_errors: extractionErrors,
  })
}
