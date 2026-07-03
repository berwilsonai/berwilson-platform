import { NextRequest } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import { embedUpdate } from '@/lib/ai/embeddings'
import { createTasksFromActionItems, type ActionItemLike } from '@/lib/tasks/from-action-items'
import type { TablesInsert } from '@/lib/supabase/types'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    project_id,
    raw_content,
    summary,
    action_items,
    waiting_on,
    risks,
    decisions,
    mentioned_parties,
    confidence,
  } = body

  if (!project_id || !raw_content) {
    return Response.json({ error: 'project_id and raw_content are required' }, { status: 400 })
  }

  const supabase = await actorAdminClient()

  // action_items deliberately not stored on the update — human-confirmed items
  // become real tasks below (the column is being dropped).
  const row: TablesInsert<'updates'> = {
    project_id,
    source: 'manual_paste',
    raw_content,
    summary: summary ?? null,
    waiting_on: waiting_on ?? [],
    risks: risks ?? [],
    decisions: decisions ?? [],
    mentioned_parties: mentioned_parties ?? [],
    confidence: typeof confidence === 'number' ? confidence : null,
    review_state: 'approved',
  }

  const { data, error } = await supabase.from('updates').insert(row).select('id').single()

  if (error) {
    console.error('Save update failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Confirmed action items → tasks on the board (user already reviewed them in the wizard)
  const tasksCreated = Array.isArray(action_items)
    ? await createTasksFromActionItems(supabase, action_items as ActionItemLike[], { projectId: project_id })
    : 0

  // Fire-and-forget: chunk and embed in background (manual pastes auto-approve)
  embedUpdate(data.id, project_id, raw_content).catch(console.error)

  return Response.json({ id: data.id, tasks_created: tasksCreated })
}
