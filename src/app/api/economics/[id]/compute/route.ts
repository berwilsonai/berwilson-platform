/**
 * POST /api/economics/[id]/compute — recompute and publish.
 *
 * ⚠ AN INVALID MODEL PUBLISHES NOTHING TO THE PIPELINE. 160 MW allocated
 * against 150 MW firm has no defensible deal size, so the record keeps whatever
 * it had and the response says why. Publishing anyway is how a blocked model
 * becomes a figure someone repeats in a meeting.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { actorFrom, requireEconomicsAccess } from '@/lib/economics/access'
import { computeDealEconomics } from '@/lib/economics'
import { captureForPipeline, loadEconomics, persistComputed } from '@/lib/economics/store'

type Params = { params: Promise<{ id: string }> }

export async function POST(_request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const loaded = await loadEconomics(access.owner.kind, access.owner.recordId)
  if (!loaded) return Response.json({ error: 'Not found' }, { status: 404 })

  const result = computeDealEconomics(loaded.input)
  await persistComputed(
    access.owner.kind,
    access.owner.recordId,
    loaded.economicsId,
    result,
    actorFrom(access.viewer)
  )

  return Response.json({
    result,
    published: result.valid,
    // Stated so the UI can say "saved, but not published, because …" rather
    // than reporting a plain success for a model nothing will read.
    pipeline_capture_value: result.valid ? captureForPipeline(result) : null,
  })
}
