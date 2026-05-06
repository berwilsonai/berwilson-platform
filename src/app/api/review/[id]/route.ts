import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedUpdate } from '@/lib/ai/embeddings'

const VALID_RESOLUTIONS = ['approved', 'rejected', 'edited'] as const
type Resolution = (typeof VALID_RESOLUTIONS)[number]

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: { resolution?: string; project_id?: string; edit_diff?: Record<string, unknown> }
  try {
    body = await request.json()
    // resolution is optional when only reassigning project
    if (body.resolution !== undefined && !VALID_RESOLUTIONS.includes(body.resolution as Resolution)) {
      return NextResponse.json({ error: 'Invalid resolution' }, { status: 400 })
    }
    if (!body.resolution && !body.project_id) {
      return NextResponse.json({ error: 'resolution or project_id required' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const resolution = body.resolution as Resolution | undefined

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // If reassigning to a different project, update both the review item and the source record
  if (body.project_id) {
    // Get the review item to find the source record
    const { data: reviewItem, error: fetchError } = await admin
      .from('review_queue')
      .select('source_table, record_id')
      .eq('id', id)
      .single()

    if (fetchError || !reviewItem) {
      return NextResponse.json({ error: 'Review item not found' }, { status: 404 })
    }

    // Update the source record's project_id (updates, documents, etc.)
    if (reviewItem.source_table === 'updates' || reviewItem.source_table === 'documents') {
      const { error: sourceError } = await admin
        .from(reviewItem.source_table)
        .update({ project_id: body.project_id })
        .eq('id', reviewItem.record_id)

      if (sourceError) {
        return NextResponse.json({ error: `Failed to reassign source record: ${sourceError.message}` }, { status: 500 })
      }
    }

    // Update the review_queue item's project_id
    const { error: reassignError } = await admin
      .from('review_queue')
      .update({ project_id: body.project_id })
      .eq('id', id)

    if (reassignError) {
      return NextResponse.json({ error: reassignError.message }, { status: 500 })
    }
  }

  // If this is a project-only reassign (no resolution), we're done
  if (!resolution) {
    return NextResponse.json({ ok: true })
  }

  // Resolve the review item — edit_diff column is new, cast until gen-types re-run
  const updatePayload: Record<string, unknown> = {
    resolution,
    resolved_at: new Date().toISOString(),
    reviewed_by: user.id,
  }
  if (body.edit_diff) updatePayload.edit_diff = body.edit_diff

  const { error } = await (admin as unknown as import('@supabase/supabase-js').SupabaseClient)
    .from('review_queue' as never)
    .update(updatePayload as never)
    .eq('id', id)
    .is('resolved_at', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Post-resolution actions based on source type
  const { data: reviewItem } = await admin
    .from('review_queue')
    .select('source_table, record_id, project_id')
    .eq('id', id)
    .single()

  if (reviewItem) {
    const db = admin as unknown as import('@supabase/supabase-js').SupabaseClient

    if (reviewItem.source_table === 'parties') {
      // Approved contact → promote to active (appears in CRM)
      // Rejected contact → stays pending_review (permanently hidden)
      if (resolution === 'approved' || resolution === 'edited') {
        await db
          .from('parties')
          .update({ status: 'active' })
          .eq('id', reviewItem.record_id)
      }
    } else if (reviewItem.source_table === 'updates' && resolution === 'approved') {
      // Trigger embedding for approved email updates
      if (reviewItem.record_id && reviewItem.project_id) {
        const { data: update } = await admin
          .from('updates')
          .select('raw_content')
          .eq('id', reviewItem.record_id)
          .single()

        if (update?.raw_content) {
          embedUpdate(reviewItem.record_id, reviewItem.project_id, update.raw_content).catch(console.error)
        }
      }
    }
  }

  return NextResponse.json({ ok: true })
}
