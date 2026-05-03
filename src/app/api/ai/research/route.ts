import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { researchQuery } from '@/lib/ai/perplexity'

export async function POST(request: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { query?: string; project_id?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { query, project_id } = body
  if (!query?.trim()) {
    return Response.json({ error: 'query is required' }, { status: 400 })
  }

  try {
    const result = await researchQuery(query.trim())

    // Store in research_artifacts
    const admin = createAdminClient()
    const { data: artifact, error: insertError } = await admin
      .from('research_artifacts')
      .insert({
        project_id: project_id ?? null,
        query_text: query.trim(),
        response_text: result.text,
        source_urls: result.sources as unknown as import('@/lib/supabase/types').Json,
        model_used: result.model,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[research] insert error', insertError)
      // Return the result even if save fails — better than a hard error
      return Response.json({ result, artifact: null })
    }

    return Response.json({ result, artifact })
  } catch (err) {
    console.error('[research] error', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Research failed' },
      { status: 500 }
    )
  }
}
