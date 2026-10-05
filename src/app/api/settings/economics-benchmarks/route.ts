/**
 * GET  /api/settings/economics-benchmarks — the library.
 * POST /api/settings/economics-benchmarks — add one.
 *
 * Admin-only by default-deny: `/api/settings/*` is in no ROLE_API_PREFIXES
 * allowlist, so middleware already blocks every other role. The in-route guard
 * is belt and braces, because `matchesPrefix` is NOT method-aware and
 * allowlisting a read path would grant every mutation under it.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson, getViewer } from '@/lib/auth/viewer'
import { calcDbAs } from '@/lib/economics/db'
import { invalidateBenchmarkCache, listBenchmarks } from '@/lib/economics/benchmarks'
import { normalizeBenchmarkPatch } from '@/lib/economics/benchmark-input'
import { explainEconomicsError } from '@/lib/economics/collections'

export async function GET() {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')
  return Response.json({ benchmarks: await listBenchmarks() })
}

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const body = (await request.json()) as Record<string, unknown>
  const normalized = normalizeBenchmarkPatch(body, { requireKey: true })
  if (!normalized.ok) return Response.json({ error: normalized.error }, { status: 400 })

  const { data, error } = await calcDbAs({ id: viewer.authUserId, email: viewer.email })
    .from('economics_benchmarks')
    .insert(normalized.value)
    .select('*')
    .single()

  if (error) {
    const message =
      error.code === '23505'
        ? 'A benchmark with that key already exists. A key is the handle every input points at, so it has to be unique.'
        : explainEconomicsError(error.message, error.code)
    return Response.json({ error: message }, { status: 400 })
  }

  // Or an edit in settings would not take effect until the next deploy.
  invalidateBenchmarkCache()
  return Response.json({ benchmark: data })
}
