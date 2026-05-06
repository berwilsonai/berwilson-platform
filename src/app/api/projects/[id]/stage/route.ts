import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const { stage } = body

  if (!stage) {
    return Response.json({ error: 'stage is required' }, { status: 400 })
  }

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
