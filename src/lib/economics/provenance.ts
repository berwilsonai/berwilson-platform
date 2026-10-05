/**
 * Provenance for the deal economics engine: where a number came from, and how
 * far an output may be trusted because of it.
 *
 * ⚠ AN OUTPUT INHERITS THE WEAKEST STATUS AMONG THE INPUTS THAT FED IT. A
 * figure derived from one planning assumption is a planning number no matter
 * how many contracted inputs sit beside it, and this is the whole reason the
 * module exists: a planning figure presented as a commitment is how a deal gets
 * priced off a guess. Nothing here averages statuses or scores them.
 *
 * The vocabulary deliberately mirrors `commitments` (CLAUDE.md, 09-24): a
 * machine may move a value freely between states it owns, and must never
 * overwrite a state a human set. `validated` and `contracted` are human acts.
 *
 * Pure, no imports. Safe for a verification script to load.
 */

export type ProvenanceStatus =
  | 'planning_assumption'
  | 'benchmark'
  | 'vendor_quoted'
  | 'loi_term_sheet'
  | 'contracted'
  | 'validated'

/**
 * Weakest first. Index in this array IS the strength, so `weakestStatus` is a
 * min over indices and nothing has to hardcode a comparison.
 */
export const PROVENANCE_ORDER: readonly ProvenanceStatus[] = [
  'planning_assumption',
  'benchmark',
  'vendor_quoted',
  'loi_term_sheet',
  'contracted',
  'validated',
]

export const PROVENANCE_LABELS: Record<ProvenanceStatus, string> = {
  planning_assumption: 'Planning assumption',
  benchmark: 'Benchmark',
  vendor_quoted: 'Vendor quoted',
  loi_term_sheet: 'LOI or term sheet',
  contracted: 'Contracted',
  validated: 'Validated',
}

/**
 * Badge tone NAMES, resolved to classes in the UI against a palette declared
 * literally in source.
 *
 * ⚠ NEVER A TAILWIND CLASS STRING (CLAUDE.md §12). Tailwind v4 emits only what
 * it finds by scanning source, so a class name that arrives from the database
 * or from a map like this one produces an unstyled element with no error
 * anywhere: not a build failure, not a console warning.
 */
export const PROVENANCE_TONES: Record<ProvenanceStatus, string> = {
  planning_assumption: 'slate',
  benchmark: 'sky',
  vendor_quoted: 'violet',
  loi_term_sheet: 'amber',
  contracted: 'emerald',
  validated: 'emerald',
}

/** What it would take to advance each status one step, shown beside an input. */
export const PROVENANCE_NEXT_STEP: Record<ProvenanceStatus, string | null> = {
  planning_assumption: 'Find a market benchmark or ask for a quote',
  benchmark: 'Get a vendor quote for this deal',
  vendor_quoted: 'Get it into an LOI or term sheet',
  loi_term_sheet: 'Get it into an executed contract',
  contracted: 'Verify it against the executed document',
  validated: null,
}

export function isProvenanceStatus(value: unknown): value is ProvenanceStatus {
  return typeof value === 'string' && (PROVENANCE_ORDER as readonly string[]).includes(value)
}

export function provenanceRank(status: ProvenanceStatus): number {
  return PROVENANCE_ORDER.indexOf(status)
}

/**
 * The weakest of a set of statuses, or null when the set is empty.
 *
 * Null means "nothing contributed", which a caller must render as unknown
 * rather than as strong. Returning `validated` for an empty set would make a
 * figure with no inputs at all look like the best-evidenced number on screen.
 */
export function weakestStatus(
  statuses: readonly (ProvenanceStatus | null | undefined)[]
): ProvenanceStatus | null {
  let weakest: ProvenanceStatus | null = null
  for (const status of statuses) {
    if (!status) continue
    if (weakest === null || provenanceRank(status) < provenanceRank(weakest)) {
      weakest = status
    }
  }
  return weakest
}

/**
 * Where a value came from, carried beside the value itself.
 *
 * `asOf` is a plain `YYYY-MM-DD`. A benchmark older than twelve months raises a
 * warning rather than expiring, because a stale benchmark is still the best
 * number anyone has until someone finds a better one.
 */
export interface Provenance {
  status: ProvenanceStatus
  /** Document, vendor, benchmark name or person. Free text, shown verbatim. */
  source: string | null
  /** A document id, a benchmark key, a message id: whatever can be chased. */
  sourceRef: string | null
  asOf: string | null
  /** What is missing to advance this one step, in the author's own words. */
  note: string | null
}

export function planningAssumption(note?: string): Provenance {
  return {
    status: 'planning_assumption',
    source: null,
    sourceRef: null,
    asOf: null,
    note: note ?? null,
  }
}

/**
 * Age of a dated provenance in whole days, or null when undated.
 *
 * An undated source is not treated as old. A floor on age would be the honest
 * reading for a creation time (CLAUDE.md, 10-05), but there is no clock at all
 * here, so the warning layer says "undated" instead of inventing one.
 */
export function provenanceAgeDays(p: Provenance, now: Date = new Date()): number | null {
  if (!p.asOf) return null
  const asOf = Date.parse(`${p.asOf}T00:00:00Z`)
  if (!Number.isFinite(asOf)) return null
  return Math.floor((now.getTime() - asOf) / 86_400_000)
}
