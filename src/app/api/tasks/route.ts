import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'
import { getViewer, filterTasksForViewer, canCreateTask, forbiddenJson } from '@/lib/auth/viewer'

/** GET — list tasks with optional filters (?status=open|done&assignee=<id>&project=<id>) */
export async function GET(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const assignee = searchParams.get('assignee')
  const project = searchParams.get('project')
  const opportunity = searchParams.get('opportunity')
  const objective = searchParams.get('objective')

  const supabase = createAdminClient()
  let query = supabase
    .from('tasks')
    .select('*, assignee:team_members(id, name, color), project:projects(id, name)')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (status === 'open' || status === 'done') query = query.eq('status', status)
  if (assignee) query = query.eq('assignee_id', assignee)
  if (project) query = query.eq('project_id', project)
  if (opportunity) query = query.eq('opportunity_id', opportunity)
  if (objective) query = query.eq('objective_id', objective)

  const { data, error } = await query
  if (error) {
    console.error('List tasks failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ tasks: await filterTasksForViewer(viewer, data ?? []) })
}

/** POST — create a task */
export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json()
  const { title, what, why, how, project_id, opportunity_id, objective_id, due_date } = body
  // Members can only add to their own list — pin the assignee server-side.
  const assignee_id = viewer.role === 'member' ? viewer.teamMemberId : body.assignee_id

  if (!title?.trim()) {
    return Response.json({ error: 'title is required' }, { status: 400 })
  }

  if (!(await canCreateTask(viewer, { assignee_id: assignee_id || null, project_id: project_id || null, opportunity_id: opportunity_id || null }))) {
    return forbiddenJson('You can only create tasks within your projects or your own list')
  }

  const row: TablesInsert<'tasks'> = {
    title: title.trim(),
    what: what?.trim() || null,
    why: why?.trim() || null,
    how: how?.trim() || null,
    assignee_id: assignee_id || null,
    project_id: project_id || null,
    due_date: due_date || null,
    status: 'open',
  }
  // Only reference the opportunity/objective tags when one is chosen, so creating
  // a task still works before those tag migrations are applied.
  if (opportunity_id) row.opportunity_id = opportunity_id
  if (objective_id) row.objective_id = objective_id

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tasks')
    .insert(row)
    .select('*, assignee:team_members(id, name, color), project:projects(id, name)')
    .single()

  if (error) {
    console.error('Create task failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ task: data })
}
