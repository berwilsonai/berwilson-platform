import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'

/** POST — create a manual task by inserting a lightweight update with a single action_item */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { project_id, text, assignee, due_date } = body

  if (!project_id || !text?.trim()) {
    return Response.json({ error: 'project_id and text are required' }, { status: 400 })
  }

  const actionItem = {
    text: text.trim(),
    assignee: assignee?.trim() || null,
    due_date: due_date || null,
    completed: false,
  }

  const supabase = createAdminClient()

  const row: TablesInsert<'updates'> = {
    project_id,
    source: 'manual_task',
    raw_content: text.trim(),
    summary: null,
    action_items: [actionItem],
    waiting_on: [],
    risks: [],
    decisions: [],
    confidence: null,
    review_state: 'approved',
  }

  const { data, error } = await supabase.from('updates').insert(row).select('id').single()

  if (error) {
    console.error('Create task failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ id: data.id, task: actionItem })
}
