import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { parseRevenueFields, type Body } from '@/lib/dino/parse'

// /api/dino is not in any role allowlist (admin-only via middleware); the
// getViewer check is defense-in-depth.
export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: Body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = parseRevenueFields(body)
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('dino_revenue').insert(result.fields).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ entry: data })
}
