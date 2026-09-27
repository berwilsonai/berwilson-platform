/**
 * How the Decide queue ranks itself.
 *
 * Pure and dependency-free so both the client list and the server-rendered
 * weekly brief can read it. They describe the same queue to the same person a
 * few hours apart; if the brief's "most consequential" disagreed with the
 * page's top row, one of them would be teaching the reader to distrust it.
 */

export interface RankableDecideItem {
  /** Days until the deadline; negative is overdue, null is no deadline. */
  daysLeft: number | null
  verdict: string | null
  score: number | null
  /** Estimated contract value, where the source carries one. */
  value?: number | null
}

/**
 * Urgency ranks above quality, but only when a real deadline exists.
 *
 * A bid closing in three days outranks a better one closing in a month, because
 * the first can stop being available. Everything without a deadline falls back
 * to quality, so the list stays "most consequential first" rather than "most
 * recently arrived".
 *
 * ⚠ `score` IS NOT A TIEBREAKER. It used to be the final term, which meant the
 * app's main work queue was ordered by a number CLAUDE.md §12 says carries ±20
 * points of sampling noise — two identical bids could swap places between
 * runs, and a whole block of rows scoring 85 was being "ranked" by noise.
 * Money is the honest tiebreaker: a $12M pursuit outranks a $2M one, and it
 * does so for the same reason every time.
 */
export function decideWeight(i: RankableDecideItem): number {
  const urgent = i.daysLeft !== null && i.daysLeft <= 7 ? 1000 : 0
  const overdue = i.daysLeft !== null && i.daysLeft < 0 ? 2000 : 0
  const verdict = i.verdict === 'pursue' || i.verdict === 'create' ? 100 : 0
  // Capped below the verdict band so a large unscored deal can never leapfrog
  // a pursue — value breaks ties inside a band, it does not define one.
  const value = Math.min((i.value ?? 0) / 1_000_000, 99)
  return overdue + urgent + verdict + value
}

/** Days from `now` to an ISO date string, or null when there is no date. */
export function daysUntil(deadline: string | null, now: number): number | null {
  if (!deadline) return null
  return Math.ceil((new Date(deadline + 'T00:00:00').getTime() - now) / 86_400_000)
}
