import { createAdminClient } from '@/lib/supabase/admin'
import AllTasksView from '@/components/tasks/AllTasksView'
import type { GlobalTask } from '@/components/tasks/AllTasksView'

export const metadata = { title: 'Tasks — Ber Wilson Intelligence' }

interface ActionItem {
  text: string
  assignee?: string
  due_date?: string
  completed?: boolean
}

export default async function TasksPage() {
  const supabase = createAdminClient()

  // Fetch all updates with action_items, joined with project name
  const { data: updates } = await supabase
    .from('updates')
    .select('id, action_items, created_at, source, project_id, projects(id, name)')
    .order('created_at', { ascending: false })

  // Fetch all projects for the "Add Task" dropdown
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name')
    .in('status', ['active', 'on_hold'])
    .order('name')

  const tasks: GlobalTask[] = []

  for (const update of updates ?? []) {
    const items: ActionItem[] = Array.isArray(update.action_items)
      ? (update.action_items as unknown as ActionItem[])
      : []

    const project = update.projects as unknown as { id: string; name: string } | null

    items.forEach((item, index) => {
      tasks.push({
        updateId: update.id,
        index,
        text: item.text ?? '',
        assignee: item.assignee ?? undefined,
        due_date: item.due_date ?? undefined,
        completed: item.completed ?? false,
        updateDate: update.created_at,
        updateSource: update.source ?? 'manual_paste',
        projectId: update.project_id ?? '',
        projectName: project?.name ?? 'Unknown Project',
      })
    })
  }

  return (
    <AllTasksView
      initialTasks={tasks}
      projects={projects ?? []}
    />
  )
}
