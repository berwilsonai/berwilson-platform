import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/types'
import { getViewer, canAccessTask, forbiddenJson, actorAdminClient, type Viewer } from '@/lib/auth/viewer'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** Load the task's tags and check the viewer may touch it. Null = allowed. */
async function guardTask(viewer: Viewer | null, id: string): Promise<Response | null> {
  if (!viewer) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (viewer.isAdmin || viewer.role === 'executive') return null
  const { data: task } = await createAdminClient()
    .from('tasks')
    .select('assignee_id, project_id, opportunity_id')
    .eq('id', id)
    .maybeSingle()
  if (!task) return Response.json({ error: 'Task not found' }, { status: 404 })
  if (!(await canAccessTask(viewer, task))) return forbiddenJson()
  return null
}

/** GET — a task plus linked project context (name, sector, value, players) and its notes feed */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const guard = await guardTask(await getViewer(), id)
  if (guard) return guard
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
  const viewer = await getViewer()
  const guard = await guardTask(viewer, id)
  if (guard) return guard
  const body = await request.json()

  // Non-executives can't retag a task onto a project/opportunity they don't have.
  if (viewer && !viewer.isAdmin && viewer.role !== 'executive') {
    const retagged = {
      assignee_id: viewer.teamMemberId,
      project_id: 'project_id' in body ? body.project_id || null : null,
      opportunity_id: 'opportunity_id' in body ? body.opportunity_id || null : null,
    }
    if ((retagged.project_id || retagged.opportunity_id) && !(await canAccessTask(viewer, retagged))) {
      return forbiddenJson('You can only tag tasks to your own projects')
    }
  }

  const supabase = await actorAdminClient()

  const patch: TablesUpdate<'tasks'> = {}
  if ('title' in body) patch.title = body.title?.trim() || 'Untitled task'
  if ('what' in body) patch.what = body.what?.trim() || null
  if ('why' in body) patch.why = body.why?.trim() || null
  if ('how' in body) patch.how = body.how?.trim() || null
  if ('assignee_id' in body) patch.assignee_id = body.assignee_id || null
  if ('project_id' in body) patch.project_id = body.project_id || null
  if ('opportunity_id' in body) patch.opportunity_id = body.opportunity_id || null
  if ('investor_id' in body) patch.investor_id = body.investor_id || null
  if ('objective_id' in body) patch.objective_id = body.objective_id || null
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
  const guard = await guardTask(await getViewer(), id)
  if (guard) return guard
  const supabase = await actorAdminClient()
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) {
    return Response.json({ error: 'Failed to delete task' }, { status: 500 })
  }
  return Response.json({ deleted: true })
}
