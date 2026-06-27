import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

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
    .from('opportunity_notes')
    .insert({
      opportunity_id: id,
      body: text,
      author: body.author?.trim() || null,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Touch the opportunity so it sorts to the top of the list
  await supabase.from('opportunities').update({ updated_at: new Date().toISOString() }).eq('id', id)

  return Response.json({ note })
}
