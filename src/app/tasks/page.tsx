import { createAdminClient } from '@/lib/supabase/admin'
import TeamTaskBoard from '@/components/tasks/TeamTaskBoard'
import type { BoardTask, TeamMember, ProjectOption, OpportunityOption } from '@/components/tasks/task-utils'

export const metadata = { title: 'Team Tasks — Ber Wilson Intelligence' }

export default async function TasksPage() {
  const supabase = createAdminClient()

  const [{ data: tasks }, { data: members }, { data: projects }, { data: opportunities }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, assignee:team_members(id, name, color), project:projects(id, name)')
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('team_members')
      .select('id, name, color')
      .eq('active', true)
      .order('created_at', { ascending: true }),
    supabase
      .from('projects')
      .select('id, name')
      .in('status', ['active', 'on_hold'])
      .order('name'),
    supabase
      .from('opportunities')
      .select('id, name')
      .not('status', 'in', '(closed_won,closed_passed)')
      .order('name'),
  ])

  return (
    <TeamTaskBoard
      initialTasks={(tasks ?? []) as unknown as BoardTask[]}
      teamMembers={(members ?? []) as TeamMember[]}
      projects={(projects ?? []) as ProjectOption[]}
      opportunities={(opportunities ?? []) as OpportunityOption[]}
    />
  )
}
