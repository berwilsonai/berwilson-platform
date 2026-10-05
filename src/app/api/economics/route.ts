/**
 * POST /api/economics — create a model for a project or opportunity.
 *
 * Admin-only by default-deny: `/api/economics` appears in no ROLE_API_PREFIXES
 * allowlist, so middleware already turns every other role away. The in-route
 * check is belt and braces, because `matchesPrefix` is NOT method-aware and
 * allowlisting this path to grant a read would grant every write under it.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { scopeFromBody } from '@/lib/records/scope'
import { requireRecordAccess } from '@/lib/economics/access'
import { explainEconomicsError } from '@/lib/economics/collections'
import { createEconomics, loadEconomics } from '@/lib/economics/store'

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

  // One model per record. Returning the existing one rather than erroring means
  // a double-click on "Start a model" cannot leave the reader looking at a
  // conflict for something that already worked.
  const existing = await loadEconomics(scope.kind, scope.id)
  if (existing) {
    return Response.json({ economics_id: existing.economicsId, created: false })
  }

  try {
    const economicsId = await createEconomics(scope.kind, scope.id, {
      id: access.viewer.authUserId,
      email: access.viewer.email,
    })
    return Response.json({ economics_id: economicsId, created: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[economics] create failed:', message)
    return Response.json({ error: explainEconomicsError(message) }, { status: 500 })
  }
}
