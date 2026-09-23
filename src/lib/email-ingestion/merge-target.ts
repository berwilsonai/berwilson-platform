/**
 * Turning the pre-decide phase's `merge_target_name` into a record id.
 *
 * Deliberately NOT a model call and not a fuzzy match. The model already chose
 * from a closed list — `candidateNames(match_candidates)` is what it was shown
 * — so the name it returned either IS one of those candidates or the model
 * invented it, and inventing is precisely the case that must not resolve.
 *
 * Lives outside the route because a route file cannot export helpers and this
 * needs to be exercised directly: merging runs only when a human clicks, so on
 * the route it would execute for the first time in production.
 */

export type MergeResolution =
  | { ok: true; projectId: string | null; opportunityId: string | null; name: string }
  | { ok: false; reason: string }

interface Candidate {
  project_id?: unknown
  project_name?: unknown
  opportunity_id?: unknown
  opportunity_name?: unknown
}

/** Case- and whitespace-insensitive, but otherwise WHOLE-name. No substrings. */
function norm(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}

export function resolveMergeTarget(
  predecision: unknown,
  matchCandidates: unknown
): MergeResolution {
  const pre = (predecision ?? {}) as Record<string, unknown>
  if (pre.disposition !== 'merge') {
    return { ok: false, reason: 'This session is not recommended for merging.' }
  }

  const wanted = norm(pre.merge_target_name)
  if (!wanted) {
    return { ok: false, reason: 'No merge target was named.' }
  }

  const candidates = Array.isArray(matchCandidates) ? (matchCandidates as Candidate[]) : []
  const hits: Array<{ projectId: string | null; opportunityId: string | null; name: string }> = []

  for (const c of candidates) {
    if (norm(c.project_name) === wanted && typeof c.project_id === 'string') {
      hits.push({ projectId: c.project_id, opportunityId: null, name: String(c.project_name) })
    }
    if (norm(c.opportunity_name) === wanted && typeof c.opportunity_id === 'string') {
      hits.push({
        projectId: null,
        opportunityId: c.opportunity_id,
        name: String(c.opportunity_name),
      })
    }
  }

  // Two candidates answering to one name is the case the thread router already
  // refuses, for the same reason: filing a conversation onto the wrong deal
  // costs more than leaving it in the queue for a human.
  const unique = new Map(hits.map((h) => [`${h.projectId}:${h.opportunityId}`, h]))
  if (unique.size > 1) {
    return {
      ok: false,
      reason: `"${String(pre.merge_target_name)}" matches more than one record — open the review screen and choose.`,
    }
  }
  const only = [...unique.values()][0]
  if (!only) {
    return {
      ok: false,
      reason: `"${String(pre.merge_target_name)}" is not one of this session's candidate records.`,
    }
  }

  return { ok: true, ...only }
}
