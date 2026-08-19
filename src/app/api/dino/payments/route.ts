import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { parsePaymentFields, type Body } from '@/lib/dino/parse'

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  let body: Body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = parsePaymentFields(body)
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('dino_payments').insert(result.fields).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ payment: data })
}
