/**
 * Who may read or write a deal's economics.
 *
 * ⚠ THESE ROUTES TAKE A RECORD ID IN THE BODY OR BEHIND AN ECONOMICS ID, SO THE
 * MIDDLEWARE STEP-UP GATE CANNOT SEE THEM. That gate only fires on a project id
 * in the PATH. A confidential project is therefore protected here or nowhere,
 * which is why every handler's first act is to resolve the economics id back to
 * its owning record and ask `canAccessRecord` — the choke point that already
 * carries the `hiddenProjectIds` check for the seven other child-record routes.
 *
 * ⚠ AND IT RESOLVES THE OWNER FROM THE DATABASE, NEVER FROM THE REQUEST. A body
 * that carries both an economics id and a project id could name a project the
 * caller is allowed to see and an economics model belonging to one they are not.
 */

import { canAccessRecord, forbiddenJson, getViewer, type Viewer } from '@/lib/auth/viewer'
import type { RecordKind } from '@/lib/records/scope'
import { calcDb } from './db'

export interface EconomicsOwner {
  economicsId: string
  kind: RecordKind
  recordId: string
}

export type AccessResult =
  | { ok: true; viewer: Viewer; owner: EconomicsOwner }
  | { ok: false; response: Response }

function notFound(): Response {
  // 404 rather than 403, matching the project layout: refusing with "forbidden"
  // confirms the model exists, and whether Ber Wilson is modelling a given deal
  // at all is itself the sensitive fact on a protected project.
  return Response.json({ error: 'Not found' }, { status: 404 })
}

/** Resolve an economics id to the record that owns it. */
export async function ownerOf(economicsId: string): Promise<EconomicsOwner | null> {
  const { data, error } = await calcDb()
    .from('deal_economics')
    .select('id,project_id,opportunity_id')
    .eq('id', economicsId)
    .maybeSingle()
  if (error) throw new Error(`Could not resolve the economics model: ${error.message}`)
  if (!data) return null

  const row = data as { id: string; project_id: string | null; opportunity_id: string | null }
  if (row.project_id) return { economicsId: row.id, kind: 'project', recordId: row.project_id }
  if (row.opportunity_id) {
    return { economicsId: row.id, kind: 'opportunity', recordId: row.opportunity_id }
  }
  // The CHECK makes this unreachable; treating it as missing rather than
  // throwing means a hypothetical bad row cannot be read by anyone.
  return null
}

/** The guard every handler on an existing model runs first. */
export async function requireEconomicsAccess(economicsId: string): Promise<AccessResult> {
  const viewer = await getViewer()
  if (!viewer) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const owner = await ownerOf(economicsId)
  if (!owner) return { ok: false, response: notFound() }

  if (!(await canAccessRecord(viewer, owner.kind, owner.recordId))) {
    return { ok: false, response: forbiddenJson() }
  }
  return { ok: true, viewer, owner }
}

/** The same guard for a record that may not have a model yet. */
export async function requireRecordAccess(
  kind: RecordKind,
  recordId: string
): Promise<{ ok: true; viewer: Viewer } | { ok: false; response: Response }> {
  const viewer = await getViewer()
  if (!viewer) return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await canAccessRecord(viewer, kind, recordId))) {
    return { ok: false, response: forbiddenJson() }
  }
  return { ok: true, viewer }
}

/** The actor every mutation is attributed to, so the audit row names a person. */
export function actorFrom(viewer: Viewer): { id: string; email?: string | null; name?: string | null } {
  return { id: viewer.authUserId, email: viewer.email, name: viewer.teamMemberName ?? viewer.email }
}
