import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = await request.json()

  if (typeof body.completed !== 'boolean') {
    return Response.json({ error: 'completed (boolean) is required' }, { status: 400 })
  }

  const update: TablesUpdate<'milestones'> = {
    completed_at: body.completed ? new Date().toISOString() : null,
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('milestones')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Update milestone failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ milestone: data })
}
