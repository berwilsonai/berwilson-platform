import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { parseRaiseFields, type RaiseBody } from '@/lib/investors/raises'

export async function POST(request: NextRequest) {
  // /api/raises is not in any role allowlist (admin-only via middleware);
  // this check is defense-in-depth.
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: RaiseBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = parseRaiseFields(body)
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('raises').insert(result.fields).select().single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ raise: data })
}
