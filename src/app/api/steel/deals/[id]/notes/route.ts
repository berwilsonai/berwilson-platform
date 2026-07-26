import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel, forbiddenJson } from '@/lib/auth/viewer'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return forbiddenJson()

  let body: { body?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const text = body.body?.trim()
  if (!text) return Response.json({ error: 'Note body is required' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: note, error } = await supabase
    .from('steel_deal_notes')
    .insert({
      deal_id: id,
      body: text,
      // Stamped from the signed-in viewer, never from the client — otherwise a
      // note could be posted under someone else's name.
      author: viewer?.teamMemberName ?? viewer?.email ?? null,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Touch the deal so it sorts to the top of the list.
  await supabase
    .from('steel_deals')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id)

  return Response.json({ note })
}
