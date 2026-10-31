import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedOpportunitySnapshot } from '@/lib/ai/embeddings'
import type { TablesUpdate } from '@/lib/supabase/types'
import { getViewer, canAccessOpportunity, forbiddenJson } from '@/lib/auth/viewer'
import { isDealStage, STAGES, STAGE_LABELS } from '@/lib/utils/constants'

interface RouteContext {
  params: Promise<{ id: string }>
}

// Fields safe to patch inline from the detail page (e.g. stage / priority pills).
const PATCHABLE = new Set([
  // ⚠ `stage` JOINED THIS ON 10-30 AND IT IS WHAT THE BOARD DRAGS. Before the
  // stage column existed the pipeline rode in `status`, so a drag wrote
  // `status` and this list was complete. A rename that stops at the column
  // leaves the route answering "No patchable fields provided" to every move —
  // which the board reports as a failed drag and then silently reverts.
  'stage', 'status', 'priority', 'opp_type', 'probability', 'next_step', 'lead', 'estimated_value',
])

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const viewer = await getViewer()
  if (!viewer || (!viewer.isAdmin && !canAccessOpportunity(viewer, id))) return forbiddenJson()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  /*
    ⚠ THE TWO CONSTRAINED COLUMNS ARE CHECKED HERE, NOT LEFT TO POSTGRES.
    `stage` is a real enum as of 10-30 and `status` carries a CHECK, so a bad
    value fails the WHOLE update rather than the field (§12) — Postgres answers
    `22P02` or `23514`, this route 500s, and the caller cannot tell a typo from
    the database being down. Both are named in the message instead.
  */
  if ('stage' in body && !isDealStage(body.stage)) {
    return Response.json(
      { error: `Unknown stage "${String(body.stage)}". Expected one of: ${STAGES.map((s) => STAGE_LABELS[s]).join(', ')}.` },
      { status: 400 }
    )
  }
  if ('status' in body && body.status !== 'active' && body.status !== 'on_hold') {
    return Response.json(
      { error: `status must be "active" or "on_hold" — it is a parking flag, and the pipeline lives on stage.` },
      { status: 400 }
    )
  }

  const update: TablesUpdate<'opportunities'> = {}
  for (const [key, value] of Object.entries(body)) {
    if (PATCHABLE.has(key)) {
      // @ts-expect-error — key is constrained to PATCHABLE keys
      update[key] = value
    }
  }

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'No patchable fields provided' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('opportunities')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Refresh the searchable snapshot (skips pre-migration)
  embedOpportunitySnapshot(id).catch(console.error)

  return Response.json({ opportunity: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson('Only admins can delete opportunities')

  const { id } = await params
  const admin = createAdminClient()

  // Remove attached files from storage (DB rows cascade on opportunity delete)
  const { data: docs } = await admin
    .from('opportunity_documents')
    .select('storage_path')
    .eq('opportunity_id', id)

  if (docs && docs.length > 0) {
    const paths = docs.map((d) => d.storage_path)
    const { error: storageError } = await admin.storage.from('documents').remove(paths)
    if (storageError) console.error('Storage cleanup failed:', storageError.message)
  }

  const { error } = await admin.from('opportunities').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
