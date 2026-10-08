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
  /**
   * A fixed lift for rows that are time-sensitive without carrying a date.
   *
   * A meeting recorded yesterday is the clearest case: there is no deadline to
   * compute, but it needs reading while the conversation is fresh and while the
   * people in it still remember agreeing to things. Left to the default
   * ordering it sank beneath 115 staged email packages, several of them weeks
   * old — which is exactly what happened to the Tensor call of 2026-10-07.
   *
   * Set from the row's KIND rather than guessed per row, and banded below
   * `urgent` on purpose: a bid closing this week still outranks it.
   */
  boost?: number
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
  return overdue + urgent + (i.boost ?? 0) + verdict + value
}

/**
 * The lift a staged meeting carries.
 *
 * 150 sits above the `pursue` band (100) and far below `urgent` (1000): a call
 * you were in yesterday should be read before a merely promising inbound bid,
 * and after one that closes on Friday.
 */
export const MEETING_BOOST = 150

/** How much of the boost is recency, at most. */
const MEETING_RECENCY = 40

/**
 * The boost for ONE meeting, freshest first.
 *
 * ⚠ A FLAT BOOST MADE ALL FIVE STAGED MEETINGS TIE, and `sort` then ordered
 * them arbitrarily — so the one line the morning note had room for went to a
 * call from nine days earlier rather than to yesterday's. A meeting decays in
 * value faster than a bid does: the follow-ups are still unassigned, the people
 * in it still remember agreeing to things, and a fortnight later it is history
 * somebody has to reconstruct.
 *
 * Capped at MEETING_BOOST + 40 = 190, which stays inside the band: a `pursue`
 * verdict on a $99M pursuit (100 + 99) still outranks it.
 */
export function meetingBoost(occurredAt: string | null | undefined, now: number): number {
  if (!occurredAt) return MEETING_BOOST
  const days = Math.max(0, -(daysUntil(occurredAt.slice(0, 10), now) ?? 0))
  return MEETING_BOOST + Math.max(0, MEETING_RECENCY - days * 2)
}

/** Days from `now` to an ISO date string, or null when there is no date. */
export function daysUntil(deadline: string | null, now: number): number | null {
  if (!deadline) return null
  return Math.ceil((new Date(deadline + 'T00:00:00').getTime() - now) / 86_400_000)
}
