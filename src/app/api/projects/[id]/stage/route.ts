import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = await request.json()
  const { stage } = body

  if (!stage) {
    return Response.json({ error: 'stage is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('projects')
    .update({ stage })
    .eq('id', id)
    .select('id, stage')
    .single()

  if (error) {
    console.error('Advance stage failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ project: data })
}
