import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    project_id?: string
    query_text?: string
    response_text?: string
    source_urls?: unknown
    model_used?: string
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { project_id, query_text, response_text, source_urls, model_used } = body
  if (!query_text?.trim() || !response_text?.trim()) {
    return Response.json({ error: 'query_text and response_text are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: artifact, error } = await admin
    .from('research_artifacts')
    .insert({
      project_id: project_id ?? null,
      query_text: query_text.trim(),
      response_text: response_text.trim(),
      source_urls: (source_urls ?? []) as import('@/lib/supabase/types').Json,
      model_used: model_used ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('[research/save] insert error', error)
    return Response.json({ error: 'Save failed' }, { status: 500 })
  }

  return Response.json({ artifact })
}
