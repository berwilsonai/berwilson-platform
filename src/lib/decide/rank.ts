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

/* ───────────────────────────── Sort orders ─────────────────────────────── */

/**
 * The orders the queue can be read in.
 *
 * ⚠ ONE FIXED ORDER WAS THE WHOLE PROBLEM. `decideWeight` answers "what is
 * most consequential", which is the right default and the wrong question for
 * somebody sifting: a queue of ~130 rows spanning six kinds needs "what landed
 * since I last looked" and "what can I clear without reading" as well, and
 * neither is derivable from consequence. These are VIEWS of one population, not
 * four populations — the counts above the list are unaffected by which is
 * chosen.
 *
 * ⚠ `score` IS DELIBERATELY NOT AN ORDER. §12: `fit_score` carries ±20 points
 * of sampling noise, and `decideWeight`'s own note records removing it as a
 * tiebreaker for exactly that reason. Offering "sort by score" would put the
 * noise back as the PRIMARY key, which is worse than the bug that was fixed.
 * `confident` sorts on the intake pre-decision's own confidence, which is a
 * different quantity (measured 0.93 average) and is already what draws the
 * batch.
 */
export type DecideSort = 'consequence' | 'recent' | 'confident' | 'quick'

/** Declaration order is reading order — this is the list the control renders. */
export const DECIDE_SORTS: readonly { value: DecideSort; label: string }[] = [
  { value: 'consequence', label: 'Most consequential' },
  { value: 'recent', label: 'Most recent' },
  { value: 'confident', label: 'Most confident' },
  { value: 'quick', label: 'Quickest to clear' },
]

/** Narrow an untrusted string — a URL — to a sort, falling back to the default. */
export function asDecideSort(raw: string | null | undefined): DecideSort {
  return DECIDE_SORTS.some((s) => s.value === raw) ? (raw as DecideSort) : 'consequence'
}

/** What a sort needs beyond what `decideWeight` reads. */
export interface SortableDecideItem extends RankableDecideItem {
  /**
   * When this row ARRIVED — not when its subject happened.
   *
   * ⚠ EVERY PRODUCER MUST FILL THIS, and `decide-sort.test.ts` asserts it does.
   * A null here cannot be distinguished by the reader from "oldest", so a kind
   * that could not supply one would silently sink to the bottom of the recent
   * view and look dealt with. §12: a bare em dash at a value's own weight reads
   * as a failed render — the same applies to a missing sort key, which has no
   * weight at all to read.
   */
  arrivedAt?: string | null
  /** 0-1, where a pre-decision was made. Null for the kinds that have none. */
  confidence?: number | null
  /** True when the row can be settled from the list, with nothing blocking it. */
  clearable?: boolean
  /**
   * The row's own id, as the FINAL tiebreak.
   *
   * ⚠ `decideWeight` IS NOT A TOTAL ORDER AND CANNOT BE THE LAST WORD. Most
   * rows in this queue carry no deadline, no verdict and no value, so their
   * weight is exactly 0 — on the live data that is every document row, the
   * largest kind present. Without a unique final key, "sort" is left to
   * whatever order the map-then-filter above happened to produce, which is the
   * flat-boost bug from MEETING_BOOST one level up: all five staged meetings
   * tied and the order was arbitrary.
   */
  id?: string
}

/** Newest first, nulls last. */
function byArrived(a: SortableDecideItem, b: SortableDecideItem): number {
  const x = a.arrivedAt ?? ''
  const y = b.arrivedAt ?? ''
  if (x === y) return 0
  if (!x) return 1
  if (!y) return -1
  return y.localeCompare(x)
}

/**
 * The comparator for one order.
 *
 * ⚠ EVERY ORDER ENDS ON THE ID, WHICH IS WHAT MAKES IT TOTAL. Falling back to
 * `decideWeight` alone is not enough — see `id` above: the weight is 0 for
 * every row with no deadline, verdict or value, which on the live queue is the
 * document rows, the biggest kind there is. A comparator that returns 0 for two
 * distinct rows lets them swap places between renders of identical data, and a
 * list that reorders itself under the reader is one they stop trusting.
 */
export function decideComparator(
  sort: DecideSort
): (a: SortableDecideItem, b: SortableDecideItem) => number {
  const tail = (a: SortableDecideItem, b: SortableDecideItem) =>
    decideWeight(b) - decideWeight(a) || (a.id ?? '').localeCompare(b.id ?? '')

  if (sort === 'recent') return (a, b) => byArrived(a, b) || tail(a, b)

  if (sort === 'confident') {
    return (a, b) => (b.confidence ?? -1) - (a.confidence ?? -1) || tail(a, b)
  }

  if (sort === 'quick') {
    // Cheapest first: a row with a button and no blocker can be settled without
    // opening it, which is the entire basis of this order. Within each group the
    // consequential one still leads.
    return (a, b) => Number(Boolean(b.clearable)) - Number(Boolean(a.clearable)) || tail(a, b)
  }

  return tail
}
