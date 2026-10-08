/**
 * POST /api/spvs/standard — set up Land, Energy and Data Center on a deal.
 *
 * ⚠ A THIN WRAPPER. The logic lives in `src/lib/spvs/standard.ts` so a setup
 * script can stand a deal's vehicles up without re-writing the naming and
 * dedupe rules beside it — a shared pass with two copies is one that drifts
 * the moment one of them is fixed (CLAUDE.md §12, 09-17), and the same rule
 * already forbids reaching the app's own HTTP routes from inside the server.
 *
 * What stays here is what only a request can decide: who is asking, and
 * whether they may write to this record.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { scopeFromBody } from '@/lib/records/scope'
import { actorFrom, requireRecordAccess } from '@/lib/spvs/access'
import { explainSpvError } from '@/lib/spvs/collections'
import { createStandardVehicles } from '@/lib/spvs/standard'

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

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

  const result = await createStandardVehicles({
    kind: scope.kind,
    recordId: scope.id,
    prefix: typeof body.prefix === 'string' ? body.prefix : '',
    suffix: typeof body.suffix === 'string' ? body.suffix : undefined,
    actor: actorFrom(access.viewer),
  })

  if ('error' in result) {
    return Response.json({ error: explainSpvError(result.error) }, { status: 400 })
  }
  return Response.json(result)
}
