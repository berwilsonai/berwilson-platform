/**
 * Who may read or write a deal's vehicles.
 *
 * ⚠ THESE ROUTES TAKE A VEHICLE ID IN THE PATH, NOT A PROJECT ID, SO THE
 * MIDDLEWARE STEP-UP GATE CANNOT SEE THEM. That gate only fires on a project id
 * in the PATH. A confidential project is therefore protected here or nowhere,
 * which is why every handler's first act is to resolve the vehicle back to its
 * owning record and ask `canAccessRecord` — the choke point that already
 * carries the `hiddenProjectIds` check.
 *
 * ⚠ AND IT RESOLVES THE OWNER FROM THE DATABASE, NEVER FROM THE REQUEST. A body
 * carrying both a vehicle id and a project id could name a project the caller
 * may see and a vehicle belonging to one they may not.
 */

import { canAccessRecord, forbiddenJson, getViewer, type Viewer } from '@/lib/auth/viewer'
import type { RecordKind } from '@/lib/records/scope'
import { spvDb } from './db'

export interface SpvOwner {
  spvId: string
  kind: RecordKind
  recordId: string
}

export type SpvAccessResult =
  | { ok: true; viewer: Viewer; owner: SpvOwner }
  | { ok: false; response: Response }

function notFound(): Response {
  // 404 rather than 403, matching the project layout: refusing with
  // "forbidden" confirms the vehicle exists, and on a protected project the
  // fact that Ber Wilson is structuring a deal at all is itself the sensitive
  // fact.
  return Response.json({ error: 'Not found' }, { status: 404 })
}

/** Resolve a vehicle id to the record that owns it. */
export async function ownerOfSpv(spvId: string): Promise<SpvOwner | null> {
  const { data, error } = await spvDb()
    .from('project_spvs')
    .select('id,project_id,opportunity_id')
    .eq('id', spvId)
    .maybeSingle()
  if (error) throw new Error(`Could not resolve the vehicle: ${error.message}`)
  if (!data) return null

  const row = data as { id: string; project_id: string | null; opportunity_id: string | null }
  if (row.project_id) return { spvId: row.id, kind: 'project', recordId: row.project_id }
  if (row.opportunity_id) {
    return { spvId: row.id, kind: 'opportunity', recordId: row.opportunity_id }
  }
  // The CHECK makes this unreachable; treating it as missing rather than
  // throwing means a hypothetical bad row cannot be read by anyone.
  return null
}

/** The guard every handler on an existing vehicle runs first. */
export async function requireSpvAccess(spvId: string): Promise<SpvAccessResult> {
  const viewer = await getViewer()
  if (!viewer) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const owner = await ownerOfSpv(spvId)
  if (!owner) return { ok: false, response: notFound() }

  if (!(await canAccessRecord(viewer, owner.kind, owner.recordId))) {
    return { ok: false, response: forbiddenJson() }
  }
  return { ok: true, viewer, owner }
}

/**
 * The same guard for a record that may not have a vehicle yet — the create
 * path, which carries a record kind and id in the body rather than a vehicle id
 * in the path.
 *
 * ⚠ DECLARED HERE AS OF 2026-10-23. It was re-exported from
 * src/lib/economics/access.ts until the calculator was removed; nothing about
 * it was ever arithmetic.
 */
export async function requireRecordAccess(
  kind: RecordKind,
  recordId: string
): Promise<{ ok: true; viewer: Viewer } | { ok: false; response: Response }> {
  const viewer = await getViewer()
  if (!viewer) {
    return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!(await canAccessRecord(viewer, kind, recordId))) {
    return { ok: false, response: forbiddenJson() }
  }
  return { ok: true, viewer }
}

/** The actor every mutation is attributed to, so the audit row names a person. */
export function actorFrom(
  viewer: Viewer
): { id: string; email?: string | null; name?: string | null } {
  return { id: viewer.authUserId, email: viewer.email, name: viewer.teamMemberName ?? viewer.email }
}
