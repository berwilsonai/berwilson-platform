import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TablesInsert } from '@/lib/supabase/types'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { project_id, stage, label, target_date } = body

  if (!project_id || !stage || !label) {
    return Response.json(
      { error: 'project_id, stage, and label are required' },
      { status: 400 }
    )
  }

  const row: TablesInsert<'milestones'> = {
    project_id,
    stage,
    label: label.trim(),
    target_date: target_date || null,
  }

  const { data, error } = await supabase
    .from('milestones')
    .insert(row)
    .select()
    .single()

  if (error) {
    console.error('Add milestone failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ milestone: data })
}
