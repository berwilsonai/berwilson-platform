/**
 * POST /api/economics/[id]/[collection] — add a source, bucket, line or
 * provenance record to a model.
 *
 * One route for four collections, driven by the specs in
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
import { getBenchmark } from '@/lib/economics/benchmarks'
import { assertSpvBelongs } from '@/lib/spvs/access'

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

  // ⚠ A VEHICLE IS NO LONGER A CHILD OF THIS MODEL, SO ITS ID MUST BE CHECKED.
  // `spv_id` is a whitelisted uuid and vehicles hang off the project instead
  // (20261006000001_project_spvs.sql), so without this a body could attribute
  // this deal's revenue to another deal's vehicle — and the ownership weight
  // would then come from a split nobody on this deal agreed to. Same reasoning
  // that keeps `economics_id` off the whitelist in the first place.
  const spvCheck = await assertSpvBelongs(normalized.value.spv_id, access.owner)
  if (spvCheck) return spvCheck

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

  const db = calcDbAs(actorFrom(access.viewer))
  const { data, error } = await db.from(spec.table).insert(row).select('*').single()

  if (error) {
    return Response.json({ error: explainEconomicsError(error.message, error.code) }, { status: 400 })
  }

  // ── Benchmark citations ───────────────────────────────────────────────────
  //
  // ⚠ FILLING AN INPUT FROM A BENCHMARK IS ONLY HALF THE ACT. The other half is
  // recording WHICH benchmark, so the figure reads as sourced rather than as a
  // number somebody typed. Without this the provenance ladder is decoration:
  // every input would sit at "planning assumption" however carefully it was
  // researched. `_sources` is a map of field name to benchmark key, outside the
  // whitelist because it writes to a different table.
  let citations = 0
  const sources = body._sources
  if (collection === 'lines' && sources && typeof sources === 'object' && !Array.isArray(sources)) {
    const lineId = (data as { id: string }).id
    const rows: Record<string, unknown>[] = []
    for (const [field, key] of Object.entries(sources as Record<string, unknown>)) {
      if (typeof key !== 'string' || !key) continue
      // Resolved server-side: a client cannot assert a source and a date the
      // library does not actually hold.
      const benchmark = await getBenchmark(key)
      if (!benchmark) continue
      rows.push({
        economics_id: id,
        line_id: lineId,
        field_key: field,
        status: 'benchmark',
        source: benchmark.label + (benchmark.source ? ` — ${benchmark.source}` : ''),
        source_ref: benchmark.key,
        as_of: benchmark.asOf,
        note: benchmark.needsReview
          ? 'This benchmark is still marked for review, so the figure is not yet a checked market rate.'
          : null,
      })
    }
    if (rows.length > 0) {
      const { error: provError } = await db.from('economics_provenance').insert(rows)
      // Non-fatal and SAID OUT LOUD. The line is already saved and discarding
      // it would be worse, but a figure that silently lost its citation reads
      // as researched when it is not.
      if (provError) {
        console.error('[economics] line saved but its benchmark citations were not:', provError.message)
        return Response.json({
          row: data,
          citations: 0,
          warning: 'The line was saved, but its benchmark sources were not recorded. Set them by hand so the figure does not read as unsourced.',
        })
      }
      citations = rows.length
    }
  }

  return Response.json({ row: data, citations })
}
