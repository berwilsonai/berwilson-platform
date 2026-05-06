import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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
    return Response.json({ result })
  } catch (err) {
    console.error('[research] error', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Research failed' },
      { status: 500 }
    )
  }
}
