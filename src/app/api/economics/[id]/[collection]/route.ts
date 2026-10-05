/**
 * POST /api/economics/[id]/[collection] — add a source, bucket, SPV, line or
 * provenance record to a model.
 *
 * One route for five collections, driven by the specs in
 * src/lib/economics/collections.ts. Nothing reaches PostgREST that is not named
 * in that spec's `fields`, which is a security boundary and not a convenience:
 * `economics_id` is absent from every whitelist, so a body cannot move a row
 * onto another deal's model.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { actorFrom, requireEconomicsAccess } from '@/lib/economics/access'
import {
  explainEconomicsError,
  getCollection,
  normalizeCollectionPayload,
} from '@/lib/economics/collections'
import { calcDb, calcDbAs } from '@/lib/economics/db'
import { lineInsert } from '@/lib/economics/store'

type Params = { params: Promise<{ id: string; collection: string }> }

export async function GET(_request: NextRequest, { params }: Params) {
  const { id, collection } = await params
  const spec = getCollection(collection)
  if (!spec) return Response.json({ error: 'Unknown collection' }, { status: 404 })

  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response

  const { data, error } = await calcDb()
    .from(spec.table)
    .select('*')
    .eq('economics_id', id)
    .order(spec.orderBy.column, { ascending: spec.orderBy.ascending, nullsFirst: false })
    .limit(1000)

  if (error) {
    return Response.json({ error: explainEconomicsError(error.message, error.code) }, { status: 400 })
  }
  return Response.json({ rows: data ?? [] })
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id, collection } = await params
  const spec = getCollection(collection)
  if (!spec) return Response.json({ error: 'Unknown collection' }, { status: 404 })

  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const body = (await request.json()) as Record<string, unknown>
  const normalized = normalizeCollectionPayload(spec, body)
  if (!normalized.ok) return Response.json({ error: normalized.error }, { status: 400 })

  // ⚠ A LINE GOES THROUGH `lineInsert` SO ITS COLUMN LIST IS COMPLETE. The
  // table has four NOT NULL booleans with defaults, and a partial column list
  // sends an explicit NULL for the ones the body omitted rather than the
  // default (CLAUDE.md §12, 09-15). The round-trip script found this.
  const row =
    collection === 'lines'
      ? lineInsert(
          id,
          String(normalized.value.line_type),
          String(normalized.value.label),
          normalized.value
        )
      : { ...normalized.value, economics_id: id }

  const { data, error } = await calcDbAs(actorFrom(access.viewer))
    .from(spec.table)
    .insert(row)
    .select('*')
    .single()

  if (error) {
    return Response.json({ error: explainEconomicsError(error.message, error.code) }, { status: 400 })
  }
  return Response.json({ row: data })
}
