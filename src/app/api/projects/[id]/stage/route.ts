import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getViewer, canAccessProject, forbiddenJson } from '@/lib/auth/viewer'
import { STAGES, STAGE_LABELS } from '@/lib/utils/constants'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const viewer = await getViewer()
  if (!viewer || (!viewer.isAdmin && !(await canAccessProject(viewer, id)))) return forbiddenJson()
  const body = await request.json()
  const { stage } = body

  if (!stage) {
    return Response.json({ error: 'stage is required' }, { status: 400 })
  }

  /*
    ⚠ VALIDATE THE MEMBER BEFORE THE UPDATE. §12: a value outside an enum
    fails the WHOLE query rather than the row — Postgres answers `22P02` and
    PostgREST returns a null row set, so an unrecognised stage would come back
    as a 500 reading "invalid input value for enum", which tells the reader
    nothing and is indistinguishable from the database being down.

    This matters more now than it did: until 2026-10-26 the only caller was a
    <select> rendered from STAGES, so the value could not be wrong. The pipeline
    board now writes this column from a drag, a key press and a tap, and a
    board whose lanes are built from a URL parameter is exactly where a stray
    value gets in.
  */
  if (!STAGES.includes(stage)) {
    return Response.json(
      { error: `Unknown stage "${String(stage)}". Expected one of: ${STAGES.map((s) => STAGE_LABELS[s]).join(', ')}.` },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('projects')
    .update({ stage })
    .eq('id', id)
    .select('id, stage')
    .single()

  if (error) {
    console.error('Advance stage failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ project: data })
}
