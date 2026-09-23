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
import { decideWeight, daysUntil } from '@/lib/decide/rank'

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


export interface DecideSummary {
  total: number
  leads: number
  intake: number
  review: number
  /** The most consequential items, already ranked, as prose lines. */
  top: string[]
}

/**
 * What the Decide queue holds, for a reader who is not looking at it.
 *
 * ⚠ Nothing anywhere told anyone this queue existed. Asked on 2026-09-23 why
 * 1,268 scored leads had produced zero records, Richard's own answer was that
 * he had not been looking — and he was right to say so, because the platform
 * announced individual arrivals once, via a latch that deliberately never
 * repeats, and then never mentioned the accumulated pile again. The weekly
 * brief is the one thing he reliably reads.
 *
 * Shares `countDecideItems`' filters and the page's `decideWeight`, so the
 * brief cannot claim a different queue or a different top item from the screen
 * it sends him to.
 */
export async function summarizeDecideQueue(now = Date.now()): Promise<DecideSummary> {
  const supabase = createAdminClient()
  const empty: DecideSummary = { total: 0, leads: 0, intake: 0, review: 0, top: [] }
  try {
    const [intake, leads, review] = await Promise.all([
      supabase
        .from('email_intake_sessions')
        .select('id, label, predecision, fit_assessment')
        .eq('status', 'pending')
        .limit(200),
      leadsDb()
        .from('leads')
        .select('id, title, sender_company, bid_due_date, fit_score, fit_recommendation')
        .in('status', ['new', 'reviewing'])
        .or('fit_recommendation.is.null,fit_recommendation.neq.pass')
        .limit(200),
      supabase
        .from('review_queue')
        .select('id', { count: 'exact', head: true })
        .is('resolved_at', null),
    ])

    const rows: Array<{ line: string; daysLeft: number | null; verdict: string | null; score: number | null }> = []

    for (const raw of (leads.data ?? []) as Array<Record<string, unknown>>) {
      const days = daysUntil((raw.bid_due_date as string) ?? null, now)
      const when =
        days === null
          ? ''
          : days < 0
            ? ` — bid closed ${Math.abs(days)}d ago`
            : days === 0
              ? ' — bid due today'
              : ` — bid due in ${days}d`
      rows.push({
        line: `Inbound bid: ${String(raw.title ?? 'Untitled')}${raw.sender_company ? ` (${String(raw.sender_company)})` : ''}${when}`,
        daysLeft: days,
        verdict: (raw.fit_recommendation as string) ?? null,
        score: typeof raw.fit_score === 'number' ? raw.fit_score : null,
      })
    }

    for (const s of intake.data ?? []) {
      const pre = (s.predecision ?? {}) as Record<string, unknown>
      if (pre.disposition === 'dismiss') continue
      const fit = (s.fit_assessment ?? {}) as Record<string, unknown>
      const score = Number(fit.fit_score)
      const headline = typeof pre.headline === 'string' && pre.headline ? ` — ${pre.headline}` : ''
      rows.push({
        line: `Staged correspondence: ${s.label || 'Untitled research package'}${headline}`,
        daysLeft: null,
        verdict: (pre.disposition as string) ?? null,
        score: Number.isFinite(score) ? score : null,
      })
    }

    rows.sort((a, b) => decideWeight(b) - decideWeight(a))

    const intakeCount = (intake.data ?? []).length
    const leadCount = (leads.data ?? []).length
    const reviewCount = review.count ?? 0
    return {
      total: intakeCount + leadCount + reviewCount,
      leads: leadCount,
      intake: intakeCount,
      review: reviewCount,
      top: rows.slice(0, 5).map((r) => r.line),
    }
  } catch {
    // Same reasoning as the count: the brief must still be written.
    return empty
  }
}
