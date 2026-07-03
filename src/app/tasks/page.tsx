import { createAdminClient } from '@/lib/supabase/admin'
import TeamTaskBoard from '@/components/tasks/TeamTaskBoard'
import type { BoardTask, TeamMember, ProjectOption, OpportunityOption, ObjectiveOption } from '@/components/tasks/task-utils'

export const metadata = { title: 'Team Tasks — Ber Wilson Intelligence' }

export default async function TasksPage() {
  const supabase = createAdminClient()

  // Objectives may not exist pre-migration; a failed select just yields null → no objective controls.
  const [{ data: tasks }, { data: members }, { data: projects }, { data: opportunities }, { data: objectives }] = await Promise.all([
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
    supabase
      .from('objectives')
      .select('id, title, bucket')
      .eq('status', 'active')
      .order('sort_order'),
  ])

  // Now → Soon → Possibly, priority order within each bucket
  const bucketRank: Record<string, number> = { now: 0, soon: 1, possibly: 2 }
  const objectiveOptions = ((objectives ?? []) as ObjectiveOption[])
    .slice()
    .sort((a, b) => (bucketRank[a.bucket] ?? 3) - (bucketRank[b.bucket] ?? 3))

  return (
    <TeamTaskBoard
      initialTasks={(tasks ?? []) as unknown as BoardTask[]}
      teamMembers={(members ?? []) as TeamMember[]}
      projects={(projects ?? []) as ProjectOption[]}
      opportunities={(opportunities ?? []) as OpportunityOption[]}
      objectives={objectiveOptions}
    />
  )
}
