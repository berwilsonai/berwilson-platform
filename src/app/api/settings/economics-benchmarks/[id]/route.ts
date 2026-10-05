/**
 * PATCH  /api/settings/economics-benchmarks/[id]
 * DELETE /api/settings/economics-benchmarks/[id]
 *
 * ⚠ DELETING A BENCHMARK IS REFUSED WHEN AN INPUT CITES IT, and the refusal
 * says how many. A benchmark's key is what an input's provenance points at, so
 * deleting a cited one would leave real figures claiming a source that no
 * longer exists. `active = false` is how a benchmark is retired, which keeps
 * every historical citation intact — the same lifecycle `lead_categories`
 * enforces with an FK and no delete rule.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson, getViewer } from '@/lib/auth/viewer'
import { calcDb, calcDbAs } from '@/lib/economics/db'
import { invalidateBenchmarkCache } from '@/lib/economics/benchmarks'
import { normalizeBenchmarkPatch } from '@/lib/economics/benchmark-input'
import { explainEconomicsError } from '@/lib/economics/collections'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const body = (await request.json()) as Record<string, unknown>
  const normalized = normalizeBenchmarkPatch(body)
  if (!normalized.ok) return Response.json({ error: normalized.error }, { status: 400 })

  const { data, error } = await calcDbAs({ id: viewer.authUserId, email: viewer.email })
    .from('economics_benchmarks')
    .update(normalized.value)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    return Response.json(
      { error: explainEconomicsError(error.message, error.code) },
      { status: 400 }
    )
  }
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })

  invalidateBenchmarkCache()
  return Response.json({ benchmark: data })
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const db = calcDb()
  const { data: row } = await db
    .from('economics_benchmarks')
    .select('key,label')
    .eq('id', id)
    .maybeSingle()
  if (!row) return Response.json({ error: 'Not found' }, { status: 404 })

  const benchmark = row as { key: string; label: string }

  // Read the citations FIRST so the refusal can name a number. Answering with a
  // raw 23503 tells the reader nothing they can act on.
  const { count, error: countError } = await db
    .from('economics_provenance')
    .select('id', { count: 'exact', head: true })
    .eq('source_ref', benchmark.key)
  if (countError) {
    return Response.json({ error: countError.message }, { status: 400 })
  }
  if ((count ?? 0) > 0) {
    return Response.json(
      {
        error: `${count} input${count === 1 ? '' : 's'} cite${count === 1 ? 's' : ''} "${benchmark.label}" as a source. Set it inactive instead, which retires it without breaking what it already priced.`,
      },
      { status: 409 }
    )
  }

  const { error } = await calcDbAs({ id: viewer.authUserId, email: viewer.email })
    .from('economics_benchmarks')
    .delete()
    .eq('id', id)
  if (error) {
    return Response.json(
      { error: explainEconomicsError(error.message, error.code) },
      { status: 400 }
    )
  }

  invalidateBenchmarkCache()
  return Response.json({ deleted: true })
}
