/**
 * POST /api/economics/[id]/extract — read this deal's documents for figures.
 *
 * ⚠ IT STAGES AND CREATES NOTHING. Everything lands as `pending` for a human.
 *
 * ⚠ AND IT IS SLOW ON PURPOSE. The local model takes 30 to 60 seconds on an
 * extraction-class task and LM Studio serves ONE request at a time, so a
 * proposal document with four slices is minutes. `maxDuration` is raised to
 * match; the alternative is a route that times out halfway and leaves the
 * reader unable to tell a failure from an empty document.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { actorFrom, requireEconomicsAccess } from '@/lib/economics/access'
import { extractEconomicsFromDocuments } from '@/lib/economics/extract'

export const maxDuration = 800

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const documentIds = Array.isArray(body.document_ids)
    ? body.document_ids.filter((v): v is string => typeof v === 'string')
    : undefined

  try {
    const result = await extractEconomicsFromDocuments(
      id,
      access.owner.kind,
      access.owner.recordId,
      actorFrom(access.viewer),
      { documentIds, userId: access.viewer.authUserId }
    )
    return Response.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[economics] extraction failed:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
