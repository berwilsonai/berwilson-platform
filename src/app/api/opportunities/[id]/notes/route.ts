import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedOpportunityNote } from '@/lib/ai/embeddings'
import { getViewer, canAccessOpportunity, forbiddenJson } from '@/lib/auth/viewer'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const viewer = await getViewer()
  if (!viewer || (!viewer.isAdmin && !canAccessOpportunity(viewer, id))) return forbiddenJson()

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
    .from('opportunity_notes')
    .insert({
      opportunity_id: id,
      body: text,
      // Stamped from the signed-in viewer, never from the client — otherwise a
      // note could be posted under someone else's name. The other four notes
      // tables already did this; these two were the holdouts, and they shipped
      // a free-text "Your name" box that made the gap look like a feature.
      author: viewer?.teamMemberName ?? viewer?.email ?? null,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Touch the opportunity so it sorts to the top of the list
  await supabase.from('opportunities').update({ updated_at: new Date().toISOString() }).eq('id', id)

  // Make the note searchable from /intel and the agent (skips pre-migration)
  embedOpportunityNote(id, text, viewer?.teamMemberName ?? viewer?.email ?? null).catch(console.error)

  return Response.json({ note })
}
