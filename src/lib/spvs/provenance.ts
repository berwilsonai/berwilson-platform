/**
 * Provenance for a vehicle and for a participant in it: where a figure came
 * from, and how far it may be trusted because of it.
 *
 * ⚠ THIS USED TO LIVE IN src/lib/economics/provenance.ts AND MOVED HERE WHEN
 * THE CALCULATOR WAS REMOVED (2026-10-23). The vocabulary was always about
 * EVIDENCE rather than arithmetic — an equity split is contracted or it is a
 * planning assumption whether or not anybody has priced the deal — so it
 * outlives the engine that first needed it. Vehicles is now its only consumer,
 * which is why it sits here rather than in a shared module nothing else reads.
 *
 * ⚠ AN OUTPUT INHERITS THE WEAKEST STATUS AMONG THE INPUTS THAT FED IT. A
 * figure derived from one planning assumption is a planning number no matter
 * how many contracted inputs sit beside it. Nothing here averages statuses or
 * scores them.
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
