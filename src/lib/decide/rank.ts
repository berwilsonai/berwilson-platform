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
}

/**
 * Urgency ranks above quality, but only when a real deadline exists.
 *
 * A bid closing in three days outranks a better one closing in a month, because
 * the first can stop being available. Everything without a deadline falls back
 * to quality, so the list stays "most consequential first" rather than "most
 * recently arrived".
 */
export function decideWeight(i: RankableDecideItem): number {
  const urgent = i.daysLeft !== null && i.daysLeft <= 7 ? 1000 : 0
  const overdue = i.daysLeft !== null && i.daysLeft < 0 ? 2000 : 0
  const verdict = i.verdict === 'pursue' || i.verdict === 'create' ? 100 : 0
  return overdue + urgent + verdict + (i.score ?? 0)
}

/** Days from `now` to an ISO date string, or null when there is no date. */
export function daysUntil(deadline: string | null, now: number): number | null {
  if (!deadline) return null
  return Math.ceil((new Date(deadline + 'T00:00:00').getTime() - now) / 86_400_000)
}
