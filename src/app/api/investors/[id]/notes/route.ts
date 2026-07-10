import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: { body?: string; author?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const text = body.body?.trim()
  if (!text) return Response.json({ error: 'Note body is required' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: note, error } = await supabase
    .from('investor_notes')
    .insert({
      investor_id: id,
      body: text,
      author: body.author?.trim() || null,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Touch the investor so it sorts to the top of the list, and treat a logged
  // note as contact having happened.
  await supabase
    .from('investors')
    .update({ updated_at: new Date().toISOString(), last_contact_date: new Date().toISOString().slice(0, 10) })
    .eq('id', id)

  return Response.json({ note })
}
