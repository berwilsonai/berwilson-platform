import { createAdminClient } from '@/lib/supabase/admin'
import TasksTab from '@/components/projects/TasksTab'
import type { BoardTask, TeamMember } from '@/components/tasks/task-utils'

export const metadata = { title: 'Tasks — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function TasksPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const [{ data: tasks }, { data: members }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, assignee:team_members!tasks_assignee_id_fkey(id, name, color), project:projects(id, name)')
      .eq('project_id', id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('team_members')
      .select('id, name, color')
      .eq('active', true)
      .order('created_at', { ascending: true }),
  ])

  return (
    <TasksTab
      projectId={id}
      initialTasks={(tasks ?? []) as unknown as BoardTask[]}
      teamMembers={(members ?? []) as TeamMember[]}
    />
  )
}
