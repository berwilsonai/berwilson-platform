import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { researchQuery } from '@/lib/ai/research'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireProjectAccess } from '@/lib/security/guard'

export async function POST(request: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = checkRateLimit(`research:${user.id}`, 15, 60_000)
  if (!rl.allowed) {
    return Response.json(
      { error: 'Rate limit exceeded. Please wait.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
    )
  }

  let body: { query?: string; project_id?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { query } = body
  if (!query?.trim()) {
    return Response.json({ error: 'query is required' }, { status: 400 })
  }

  /**
   * ⚠ `project_id` WAS DECLARED HERE AND NEVER READ. The body type has named it
   * since the route was written, so every reader assumed research was scoped to
   * the project — it was not, and a protected project's id could be posted here
   * with no check at all. The guard belongs on a route with the id in its BODY;
   * the middleware gate can only see one in the PATH (§12).
   */
  const denied = await requireProjectAccess(body.project_id)
  if (denied) return denied

  try {
    const result = await researchQuery(query.trim(), { userId: user.id })
    return Response.json({ result })
  } catch (err) {
    console.error('[research] error', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Research failed' },
      { status: 500 }
    )
  }
}
