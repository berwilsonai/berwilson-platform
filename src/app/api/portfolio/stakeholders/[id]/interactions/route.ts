import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesInsert } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  if (!body.summary?.trim()) {
    return Response.json({ error: 'summary is required' }, { status: 400 })
  }

  const row: TablesInsert<'stakeholder_interactions'> = {
    relationship_id: id,
    summary: body.summary.trim(),
    interaction_date: body.interaction_date || new Date().toISOString().split('T')[0],
    medium: body.medium || null,
    follow_up: body.follow_up?.trim() || null,
    logged_by: user.email || null,
  }

  const { data, error } = await supabase
    .from('stakeholder_interactions')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Create interaction failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ interaction: data })
}
