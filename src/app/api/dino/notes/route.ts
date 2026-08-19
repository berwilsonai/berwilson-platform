import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: { body?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const text = body.body?.trim()
  if (!text) return Response.json({ error: 'Note body is required' }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('dino_notes')
    // author is stamped server-side from the session — never taken from the client
    .insert({ body: text, author: viewer?.teamMemberName ?? null })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ note: data })
}
