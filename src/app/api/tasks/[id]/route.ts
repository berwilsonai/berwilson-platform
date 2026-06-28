import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** GET — a task plus linked project context (name, sector, value, players) and its notes feed */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: task, error } = await supabase
    .from('tasks')
    .select('*, assignee:team_members(id, name, color), project:projects(id, name, sector, estimated_value, location, stage, status)')
    .eq('id', id)
    .single()

  if (error || !task) {
    return Response.json({ error: 'Task not found' }, { status: 404 })
  }

  // Notes feed (oldest first, like a conversation)
  const { data: notes } = await supabase
    .from('task_notes')
    .select('*')
    .eq('task_id', id)
    .order('created_at', { ascending: true })

  // Players on the linked project, for the context card
  let players: { role: string; name: string; is_primary: boolean }[] = []
  if (task.project_id) {
    const { data: pp } = await supabase
      .from('project_players')
      .select('role, is_primary, parties(full_name)')
      .eq('project_id', task.project_id)
      .order('is_primary', { ascending: false })
    players = (pp ?? []).map((row) => ({
      role: row.role,
      is_primary: row.is_primary ?? false,
      name: (row.parties as { full_name: string } | null)?.full_name ?? 'Unknown',
    }))
  }

  return Response.json({ task, notes: notes ?? [], players })
}

/** PATCH — edit task fields. Setting status='done' stamps completed_at; 'open' clears it. */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const body = await request.json()
  const supabase = createAdminClient()

  const patch: TablesUpdate<'tasks'> = {}
  if ('title' in body) patch.title = body.title?.trim() || 'Untitled task'
  if ('what' in body) patch.what = body.what?.trim() || null
  if ('why' in body) patch.why = body.why?.trim() || null
  if ('how' in body) patch.how = body.how?.trim() || null
  if ('assignee_id' in body) patch.assignee_id = body.assignee_id || null
  if ('project_id' in body) patch.project_id = body.project_id || null
  if ('opportunity_id' in body) patch.opportunity_id = body.opportunity_id || null
  if ('due_date' in body) patch.due_date = body.due_date || null
  if ('status' in body) {
    patch.status = body.status === 'done' ? 'done' : 'open'
    patch.completed_at = body.status === 'done' ? new Date().toISOString() : null
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .select('*, assignee:team_members(id, name, color), project:projects(id, name)')
    .single()

  if (error) {
    console.error('Update task failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ task: data })
}

/** DELETE — remove a task entirely (notes cascade) */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) {
    return Response.json({ error: 'Failed to delete task' }, { status: 500 })
  }
  return Response.json({ deleted: true })
}
