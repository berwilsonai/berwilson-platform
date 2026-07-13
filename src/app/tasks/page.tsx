import { createAdminClient } from '@/lib/supabase/admin'
import TeamTaskBoard from '@/components/tasks/TeamTaskBoard'
import type { BoardTask, TeamMember, ProjectOption, OpportunityOption, InvestorOption, ObjectiveOption } from '@/components/tasks/task-utils'
import { getViewer, filterTasksForViewer, accessibleProjectIds } from '@/lib/auth/viewer'

export const metadata = { title: 'Team Tasks — Ber Wilson Intelligence' }

export default async function TasksPage() {
  const supabase = createAdminClient()
  const viewer = await getViewer()

  // Objectives may not exist pre-migration; a failed select just yields null → no objective controls.
  const [{ data: tasks }, { data: members }, { data: projects }, { data: opportunities }, { data: investors }, { data: objectives }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, assignee:team_members!tasks_assignee_id_fkey(id, name, color), project:projects(id, name)')
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
      .from('investors')
      .select('id, name')
      .not('stage', 'in', '(passed,dormant)')
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

  // Scope the board to the viewer. Admin/executive: the whole team board.
  // Project manager: tasks + tag pickers narrowed to their granted
  // projects/opportunities (plus tasks assigned to them). Member: own list,
  // no tag pickers. Objectives stay executive-level context.
  let boardTasks = (tasks ?? []) as unknown as BoardTask[]
  let projectOptions = (projects ?? []) as ProjectOption[]
  let opportunityOptions = (opportunities ?? []) as OpportunityOption[]
  // Investor data is admin-only (capital raise is sensitive) — everyone else
  // gets no investor picker/chips, even executives.
  const investorOptions: InvestorOption[] =
    !viewer || viewer.isAdmin ? ((investors ?? []) as InvestorOption[]) : []
  let visibleObjectives = objectiveOptions
  if (viewer && !viewer.isAdmin && viewer.role !== 'executive') {
    boardTasks = await filterTasksForViewer(viewer, boardTasks)
    visibleObjectives = []
    if (viewer.role === 'project_manager') {
      const projectIds = (await accessibleProjectIds(viewer)) ?? new Set<string>()
      projectOptions = projectOptions.filter((p) => projectIds.has(p.id))
      opportunityOptions = opportunityOptions.filter((o) => viewer.grantedOpportunityIds.includes(o.id))
    } else {
      projectOptions = []
      opportunityOptions = []
    }
  }

  return (
    <TeamTaskBoard
      initialTasks={boardTasks}
      teamMembers={(members ?? []) as TeamMember[]}
      projects={projectOptions}
      opportunities={opportunityOptions}
      investors={investorOptions}
      objectives={visibleObjectives}
      showWeeklyReport={!viewer || viewer.isAdmin}
    />
  )
}
