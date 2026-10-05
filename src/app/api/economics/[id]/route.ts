/**
 * GET    /api/economics/[id] — the model, computed.
 * PATCH  /api/economics/[id] — the deal-level inputs.
 * DELETE /api/economics/[id] — remove the model.
 *
 * The GET recomputes rather than serving the stored figures, so a reader never
 * sees a number that disagrees with the inputs on the same screen. The stored
 * columns exist for the pipeline, which cannot run the engine.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { actorFrom, requireEconomicsAccess } from '@/lib/economics/access'
import { computeDealEconomics } from '@/lib/economics'
import { explainEconomicsError } from '@/lib/economics/collections'
import { calcDbAs } from '@/lib/economics/db'
import { loadEconomics } from '@/lib/economics/store'

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response

  const loaded = await loadEconomics(access.owner.kind, access.owner.recordId)
  if (!loaded) return Response.json({ error: 'Not found' }, { status: 404 })

  return Response.json({
    economics_id: loaded.economicsId,
    record: { kind: access.owner.kind, id: access.owner.recordId },
    input: loaded.input,
    result: computeDealEconomics(loaded.input),
    notes: loaded.notes,
    stored_at: loaded.storedAt,
  })
}

/**
 * The deal-level inputs: discount rate, cap rate, base year, stated total.
 *
 * ⚠ THE COLUMN LIST HERE IS THE WHITELIST. `computed_*` is absent on purpose:
 * those are the engine's output, and a body that could set them would let a
 * caller publish a deal size the engine never agreed to.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const body = (await request.json()) as Record<string, unknown>
  const patch: Record<string, unknown> = {}

  const numeric = ['discount_rate_pct', 'cap_rate_pct', 'stated_total_amount'] as const
  for (const field of numeric) {
    if (!(field in body)) continue
    const raw = body[field]
    if (raw == null || raw === '') {
      // Clearing a rate means "nobody has said", never 0.
      patch[field] = null
      continue
    }
    const value = Number(String(raw).replace(/[$,\s]/g, ''))
    if (!Number.isFinite(value)) {
      return Response.json({ error: `"${field}" is not a number` }, { status: 400 })
    }
    patch[field] = value
  }

  if ('base_year' in body) {
    const raw = body.base_year
    if (raw == null || raw === '') patch.base_year = null
    else {
      const year = Number(raw)
      if (!Number.isInteger(year) || year < 1900 || year > 2200) {
        return Response.json({ error: 'Base year must be a four-digit year' }, { status: 400 })
      }
      patch.base_year = year
    }
  }

  if ('stated_total_shape' in body) {
    const raw = body.stated_total_shape
    const shapes = ['recurring', 'contract', 'one_time', 'asset', 'capture']
    if (raw == null || raw === '') patch.stated_total_shape = null
    else if (typeof raw !== 'string' || !shapes.includes(raw)) {
      return Response.json(
        { error: `A stated total must say which figure it is: ${shapes.join(', ')}` },
        { status: 400 }
      )
    } else patch.stated_total_shape = raw
  }

  if ('notes' in body) {
    const raw = body.notes
    patch.notes = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await calcDbAs(actorFrom(access.viewer))
    .from('deal_economics')
    .update(patch)
    .eq('id', id)
    .select('id')
    .single()

  if (error) {
    return Response.json(
      { error: explainEconomicsError(error.message, error.code) },
      { status: 400 }
    )
  }
  return Response.json({ economics_id: (data as { id: string }).id })
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const db = calcDbAs(actorFrom(access.viewer))
  const { error } = await db.from('deal_economics').delete().eq('id', id)
  if (error) {
    return Response.json(
      { error: explainEconomicsError(error.message, error.code) },
      { status: 400 }
    )
  }

  // The pipeline column has to go with it, or the record keeps advertising a
  // capture figure computed from a model that no longer exists.
  const table = access.owner.kind === 'project' ? 'projects' : 'opportunities'
  const { error: rollupError } = await db
    .from(table)
    .update({
      economics_capture_value: null,
      economics_status: null,
      economics_computed_at: null,
    })
    .eq('id', access.owner.recordId)
  if (rollupError) {
    console.error('[economics] model deleted but the pipeline value remains:', rollupError.message)
    return Response.json(
      { error: 'The model was deleted but the pipeline value could not be cleared.' },
      { status: 500 }
    )
  }

  return Response.json({ deleted: true })
}
