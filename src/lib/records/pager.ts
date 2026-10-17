/**
 * Where a record sits in its register, and what prev/next should be.
 *
 * ⚠ PURE, AND IN src/lib, SO THE RULES CAN BE ASSERTED. The interesting part
 * of a prev/next control is not the arrows, it is WHICH records are in the
 * chain — and that is a containment decision (§8): a cross-portfolio list must
 * not become a way to enumerate protected names, and a position like "4 of 19"
 * must not quietly count one. Those rules are untestable while they live inside
 * an async server component that opens a database connection.
 */

export interface PagerRow {
  id: string
  name: string
}

export interface PagerPosition {
  prev: PagerRow | null
  next: PagerRow | null
  /** 1-based, for display. */
  index: number
  total: number
}

/**
 * `rows` must already be ordered and already filtered by grants. `hidden` is
 * the set this viewer may not see; it is applied here rather than by the caller
 * so that the exclusion and the COUNT cannot come apart — deriving the total
 * before the filter is how a disclosure happens (§12).
 *
 * Returns null — meaning "render nothing" — when:
 *   · the current record is itself hidden. A position in a list it has been
 *     removed from is not a meaningful number, and showing a chain around it
 *     would leak its neighbours' order.
 *   · the current record is not in its own register at all (filtered out by a
 *     grant, or moved between two queries). "0 of 19" is worse than silence.
 *   · there is nowhere to go: fewer than two records.
 */
export function pagerPosition(
  rows: PagerRow[],
  currentId: string,
  hidden: ReadonlySet<string> = new Set()
): PagerPosition | null {
  if (hidden.has(currentId)) return null

  const visible = rows.filter((r) => !hidden.has(r.id))
  const i = visible.findIndex((r) => r.id === currentId)
  if (i === -1 || visible.length < 2) return null

  return {
    prev: i > 0 ? visible[i - 1] : null,
    next: i < visible.length - 1 ? visible[i + 1] : null,
    index: i + 1,
    total: visible.length,
  }
}
