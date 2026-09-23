/**
 * One definition of "which record does this child row belong to".
 *
 * Projects and opportunities share their child tables — players, milestones,
 * diligence, financing, entities — distinguished by which of two nullable
 * columns is set (see 20260923000002_opportunity_parity.sql). Every writer
 * builds the scope the same way through here, so a component or route cannot
 * invent a third spelling.
 */

export type RecordKind = 'project' | 'opportunity'

export const RECORD_SCOPE_COLUMN: Record<RecordKind, 'project_id' | 'opportunity_id'> = {
  project: 'project_id',
  opportunity: 'opportunity_id',
}

/** The `{ project_id }` / `{ opportunity_id }` pair to send in a write body. */
export function scopeBody(kind: RecordKind, id: string): Record<string, string> {
  return { [RECORD_SCOPE_COLUMN[kind]]: id }
}

/**
 * Read the scope out of an incoming request body. Returns null when neither or
 * BOTH are present — the same "exactly one" rule the database check enforces,
 * applied at the edge so the caller gets a 400 rather than a 500.
 */
export function scopeFromBody(
  body: Record<string, unknown>
): { kind: RecordKind; id: string; column: 'project_id' | 'opportunity_id' } | null {
  const projectId = typeof body.project_id === 'string' && body.project_id ? body.project_id : null
  const opportunityId =
    typeof body.opportunity_id === 'string' && body.opportunity_id ? body.opportunity_id : null
  if (projectId && opportunityId) return null
  if (projectId) return { kind: 'project', id: projectId, column: 'project_id' }
  if (opportunityId) return { kind: 'opportunity', id: opportunityId, column: 'opportunity_id' }
  return null
}

export const RECORD_BASE_PATH: Record<RecordKind, string> = {
  project: '/projects',
  opportunity: '/opportunities',
}
