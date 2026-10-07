/**
 * GET  /api/spvs?project_id=… — the vehicles on a deal, with their participants.
 * POST /api/spvs             — add a vehicle to a project or opportunity.
 *
 * Admin-only by default-deny: `/api/spvs` appears in no ROLE_API_PREFIXES
 * allowlist, so middleware already turns every other role away. The in-route
 * check is belt and braces, because `matchesPrefix` is NOT method-aware and
 * allowlisting this path to grant a read would grant every write under it.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { scopeFromBody, type RecordKind } from '@/lib/records/scope'
import { actorFrom, requireRecordAccess } from '@/lib/spvs/access'
import { explainSpvError, normalizeSpv } from '@/lib/spvs/collections'
import { spvDbAs } from '@/lib/spvs/db'
import { resolveOrgNodeName } from '@/lib/spvs/org-node'
import { loadProjectSpvs } from '@/lib/spvs/queries'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const opportunityId = searchParams.get('opportunity_id')

  let kind: RecordKind
  let recordId: string
  if (projectId && !opportunityId) {
    kind = 'project'
    recordId = projectId
  } else if (opportunityId && !projectId) {
    kind = 'opportunity'
    recordId = opportunityId
  } else {
    return Response.json(
      { error: 'Exactly one of project_id or opportunity_id is required' },
      { status: 400 }
    )
  }

  const access = await requireRecordAccess(kind, recordId)
  if (!access.ok) return access.response

  try {
    return Response.json({ spvs: await loadProjectSpvs(kind, recordId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ error: explainSpvError(message) }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>

  // Exactly one of project_id / opportunity_id, the same rule the table's own
  // CHECK enforces, applied here so the caller gets a 400 and not a 500.
  const scope = scopeFromBody(body)
  if (!scope) {
    return Response.json(
      { error: 'Exactly one of project_id or opportunity_id is required' },
      { status: 400 }
    )
  }

  const access = await requireRecordAccess(scope.kind, scope.id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const normalized = normalizeSpv(body)
  if (!normalized.ok) return Response.json({ error: normalized.error }, { status: 400 })

  const snapshot = await resolveOrgNodeName(normalized.value.org_node_id)
  if ('error' in snapshot) return Response.json(snapshot, { status: 400 })

  // The scope columns are NOT in the whitelist, so they are added here from the
  // scope the route resolved — a body cannot put a vehicle on another deal.
  const row = {
    ...normalized.value,
    ...snapshot.value,
    [scope.column]: scope.id,
  }

  const { data, error } = await spvDbAs(actorFrom(access.viewer))
    .from('project_spvs')
    .insert(row)
    .select('*')
    .single()

  if (error) {
    return Response.json({ error: explainSpvError(error.message, error.code) }, { status: 400 })
  }
  return Response.json({ row: data })
}
