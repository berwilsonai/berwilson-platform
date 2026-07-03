import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'
import { getViewer, canAccessTask, forbiddenJson } from '@/lib/auth/viewer'

interface RouteContext {
  params: Promise<{ id: string }>
}

/** POST — add a note to a task's updates feed */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin && viewer.role !== 'executive') {
    const { data: task } = await createAdminClient()
      .from('tasks')
      .select('assignee_id, project_id, opportunity_id')
      .eq('id', id)
      .maybeSingle()
    if (!task || !(await canAccessTask(viewer, task))) return forbiddenJson()
  }

  const body = await request.json()
  const { body: noteBody, author } = body

  if (!noteBody?.trim()) {
    return Response.json({ error: 'body is required' }, { status: 400 })
  }

  const row: TablesInsert<'task_notes'> = {
    task_id: id,
    body: noteBody.trim(),
    author: author?.trim() || null,
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('task_notes').insert(row).select('*').single()

  if (error) {
    console.error('Add note failed:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ note: data })
}
