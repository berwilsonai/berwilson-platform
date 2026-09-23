import { createAdminClient } from '@/lib/supabase/admin'
import OpportunityTasks from '@/components/opportunities/OpportunityTasks'
import type { BoardTask, TeamMember } from '@/components/tasks/task-utils'

export const metadata = { title: 'Tasks — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function OpportunityTasksPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const [{ data: tasks }, { data: members }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, assignee:team_members!tasks_assignee_id_fkey(id, name, color), project:projects(id, name)')
      .eq('opportunity_id', id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('team_members')
      .select('id, name, color')
      .eq('active', true)
      .order('created_at', { ascending: true }),
  ])

  return (
    <OpportunityTasks
      opportunityId={id}
      initialTasks={(tasks ?? []) as unknown as BoardTask[]}
      teamMembers={(members ?? []) as TeamMember[]}
    />
  )
}
