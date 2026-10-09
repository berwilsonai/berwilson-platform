/**
 * The records this browser opened last.
 *
 * ⚠ Per-viewer and per-browser ON PURPOSE. This is a convenience, not a
 * record: it never leaves the machine, it is allowed to come back empty (a
 * cleared cache, a private window, a second laptop), and nothing in the app
 * may read it to decide anything. Every accessor is wrapped, because reading
 * localStorage THROWS outright when site data is blocked rather than
 * returning null.
 *
 * Lives in `src/lib` rather than beside the palette so a server page can
 * import the type without pulling a client module into its tree (§12).
 */

/** The record kinds worth remembering — the same vocabulary the search API returns. */
export type RecentKind =
  | 'project'
  | 'opportunity'
  | 'contact'
  | 'vendor'
  | 'investor'
  | 'steel'
  | 'document'

export interface RecentRecord {
  kind: RecentKind
  /** What the record is called, as the reader would say it. */
  label: string
  /** Where it lives. Also the identity: one entry per href. */
  href: string
  /** Epoch ms of the last visit. */
  at: number
}

const KEY = 'bw-recent-records'
/** Eight fits the palette without scrolling; twelve is the memory behind it. */
const MAX = 12

export function readRecents(): RecentRecord[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is RecentRecord =>
        !!r &&
        typeof r === 'object' &&
        typeof (r as RecentRecord).href === 'string' &&
        typeof (r as RecentRecord).label === 'string'
    )
  } catch {
    return []
  }
}

/**
 * Record a visit, newest first, one entry per href.
 *
 * The label is re-written on every visit rather than kept from the first one,
 * so a renamed deal shows its current name here instead of the name it had
 * when it was last opened.
 */
export function recordVisit(visit: Omit<RecentRecord, 'at'>): void {
  if (!visit.href || !visit.label) return
  try {
    const next = [
      { ...visit, at: Date.now() },
      ...readRecents().filter((r) => r.href !== visit.href),
    ].slice(0, MAX)
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable — recents are a convenience, never a record */
  }
}
