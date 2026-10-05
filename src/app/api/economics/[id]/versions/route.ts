/**
 * GET  /api/economics/[id]/versions — the history.
 * POST /api/economics/[id]/versions — freeze the model as a new version.
 *
 * A version is a deliberate act with a label and a note, not an autosave. The
 * column-by-column audit trail already records every edit; this records the
 * moments someone wants to be able to come back to, and WHY, which a diff
 * cannot say.
 */

import { NextRequest } from 'next/server'
import { forbiddenJson } from '@/lib/auth/viewer'
import { actorFrom, requireEconomicsAccess } from '@/lib/economics/access'
import { computeDealEconomics } from '@/lib/economics'
import { calcDb } from '@/lib/economics/db'
import { loadEconomics, saveVersion } from '@/lib/economics/store'

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response

  // The snapshots are large, so the list carries only what a history reads by.
  const { data, error } = await calcDb()
    .from('economics_versions')
    .select('id,version,label,note,created_by,created_at')
    .eq('economics_id', id)
    .order('version', { ascending: false })
    .limit(200)

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ versions: data ?? [] })
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await requireEconomicsAccess(id)
  if (!access.ok) return access.response
  if (!access.viewer.isAdmin) return forbiddenJson('Admin only')

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null

  const loaded = await loadEconomics(access.owner.kind, access.owner.recordId)
  if (!loaded) return Response.json({ error: 'Not found' }, { status: 404 })

  // An invalid model can still be versioned on purpose: "this is where it was
  // when we found the 10 MW problem" is worth being able to come back to.
  const result = computeDealEconomics(loaded.input)
  const version = await saveVersion(
    loaded.economicsId,
    loaded.input,
    result,
    { label, note },
    actorFrom(access.viewer)
  )

  return Response.json({ version, valid: result.valid })
}
