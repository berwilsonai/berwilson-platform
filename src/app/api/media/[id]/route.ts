import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteParams {
  params: Promise<{ id: string }>
}

// DELETE /api/media/[id] — remove photo from storage and DB
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: photo } = await supabase
    .from('media')
    .select('storage_path, is_primary, project_id, entity_id, party_id, is_company')
    .eq('id', id)
    .single()

  if (!photo) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // Delete from storage
  await supabase.storage.from('media').remove([photo.storage_path])

  // Delete DB record
  const { error } = await supabase.from('media').delete().eq('id', id)
  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // If deleted photo was primary, promote the oldest remaining photo
  if (photo.is_primary) {
    let nextQuery = supabase.from('media').select('id').order('created_at').limit(1)
    if (photo.project_id) nextQuery = nextQuery.eq('project_id', photo.project_id)
    else if (photo.entity_id) nextQuery = nextQuery.eq('entity_id', photo.entity_id)
    else if (photo.party_id) nextQuery = nextQuery.eq('party_id', photo.party_id)
    else nextQuery = nextQuery.eq('is_company', true)

    const { data: next } = await nextQuery
    if (next && next.length > 0) {
      await supabase.from('media').update({ is_primary: true }).eq('id', next[0].id)
    }
  }

  return Response.json({ ok: true })
}

// PATCH /api/media/[id] — update is_primary or caption
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = createAdminClient()

  const body = await request.json() as { is_primary?: boolean; caption?: string | null; sort_order?: number }

  // Fetch photo to get scope info
  const { data: photo } = await supabase
    .from('media')
    .select('project_id, entity_id, party_id, is_company')
    .eq('id', id)
    .single()

  if (!photo) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // If setting primary, unset current primary in same scope first
  if (body.is_primary === true) {
    let unsetQuery = supabase.from('media').update({ is_primary: false }).eq('is_primary', true).neq('id', id)
    if (photo.project_id) unsetQuery = unsetQuery.eq('project_id', photo.project_id)
    else if (photo.entity_id) unsetQuery = unsetQuery.eq('entity_id', photo.entity_id)
    else if (photo.party_id) unsetQuery = unsetQuery.eq('party_id', photo.party_id)
    else unsetQuery = unsetQuery.eq('is_company', true)
    await unsetQuery
  }

  const updates: TablesUpdate<'media'> = {}
  if (body.is_primary !== undefined) updates.is_primary = body.is_primary
  if ('caption' in body) updates.caption = body.caption
  if (body.sort_order !== undefined) updates.sort_order = body.sort_order

  const { data: updated, error } = await supabase
    .from('media')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ photo: updated })
}
