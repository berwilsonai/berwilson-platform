/**
 * POST /api/spvs/[id]/participants — add a participant to a vehicle.
 *
 * A participant row is simultaneously the equity split and the capital raise
 * line: `equity_pct` says how much of the vehicle they hold, `capital_committed`
 * and `capital_funded` say what they have put in. They are the same ledger, so
 * they are the same row and cannot disagree.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { actorFrom, requireSpvAccess } from '@/lib/spvs/access'
import { explainSpvError, normalizeParticipant } from '@/lib/spvs/collections'
import { spvDbAs } from '@/lib/spvs/db'

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await requireSpvAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const body = (await request.json()) as Record<string, unknown>
  const normalized = normalizeParticipant(body)
  if (!normalized.ok) return Response.json({ error: normalized.error }, { status: 400 })

  // `spv_id` is NOT in the whitelist, so it comes from the path the access
  // guard already resolved — a body cannot file a participant into another
  // deal's vehicle.
  const { data, error } = await spvDbAs(actorFrom(access.viewer))
    .from('project_spv_participants')
    .insert({ ...normalized.value, spv_id: id })
    .select('*')
    .single()

  if (error) {
    return Response.json({ error: explainSpvError(error.message, error.code) }, { status: 400 })
  }
  return Response.json({ row: data })
}
