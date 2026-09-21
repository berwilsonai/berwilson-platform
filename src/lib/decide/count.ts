/**
 * How many items the Decide queue actually holds.
 *
 * The sidebar badge on Decide counted `review_queue` alone — it predates the
 * Decide page, having been the Review Queue badge — so it read 68 against a
 * page holding 238. A badge that under-reports its own destination by three
 * and a half times is worse than no badge: it sets an expectation the page
 * immediately contradicts.
 *
 * Kept beside the page's filters rather than inside it because the two ask
 * different questions of the same rows (a count versus the rows themselves),
 * and the only thing that must not drift is WHICH rows count.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { leadsDb } from '@/lib/leads/db'

export async function countDecideItems(): Promise<number> {
  const supabase = createAdminClient()
  try {
    const [intake, leads, review] = await Promise.all([
      supabase
        .from('email_intake_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      leadsDb()
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .in('status', ['new', 'reviewing'])
        // The page drops leads the assessor said to pass on. `.neq()` would
        // ALSO drop every unscored lead, because PostgREST treats NULL as not
        // matching — and an untriaged bid invitation is exactly the thing that
        // most needs deciding.
        .or('fit_recommendation.is.null,fit_recommendation.neq.pass'),
      supabase
        .from('review_queue')
        .select('id', { count: 'exact', head: true })
        .is('resolved_at', null),
    ])
    return (intake.count ?? 0) + (leads.count ?? 0) + (review.count ?? 0)
  } catch {
    // The shell must render even if a count fails; a missing badge is a far
    // smaller problem than a missing sidebar.
    return 0
  }
}
