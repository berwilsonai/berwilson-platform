import { createAdminClient } from '@/lib/supabase/admin'
import TasksTab from '@/components/projects/TasksTab'
import type { FlatTask } from '@/components/projects/TasksTab'

interface PageProps {
  params: Promise<{ id: string }>
}

interface ActionItem {
  text: string
  assignee?: string
  due_date?: string
  completed?: boolean
}

export default async function TasksPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: updates } = await supabase
    .from('updates')
    .select('id, action_items, created_at, source')
    .eq('project_id', id)
    .order('created_at', { ascending: false })

  const flatTasks: FlatTask[] = []

  for (const update of updates ?? []) {
    const items: ActionItem[] = Array.isArray(update.action_items)
      ? (update.action_items as unknown as ActionItem[])
      : []

    items.forEach((item, index) => {
      flatTasks.push({
        updateId: update.id,
        index,
        text: item.text ?? '',
        assignee: item.assignee ?? undefined,
        due_date: item.due_date ?? undefined,
        completed: item.completed ?? false,
        updateDate: update.created_at,
        updateSource: update.source ?? 'manual_paste',
      })
    })
  }

  return <TasksTab projectId={id} initialTasks={flatTasks} />
}
