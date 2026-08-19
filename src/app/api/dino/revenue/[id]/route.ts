import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { parseRevenueFields, type Body } from '@/lib/dino/parse'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

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
  const { data, error } = await supabase
    .from('dino_revenue')
    .update(result.fields)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ entry: data })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) return forbiddenJson()

  const supabase = createAdminClient()
  const { error } = await supabase.from('dino_revenue').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
