import { createAdminClient } from '@/lib/supabase/admin'
import TeamTaskBoard from '@/components/tasks/TeamTaskBoard'
import type { BoardTask, TeamMember, ProjectOption, OpportunityOption, InvestorOption, ObjectiveOption } from '@/components/tasks/task-utils'
import { getViewer, filterTasksForViewer, accessibleProjectIds } from '@/lib/auth/viewer'
import { dropHidden } from '@/lib/security/confidential'
import { viewerHiddenProjectIds } from '@/lib/security/request'
import { loadLiveContext } from '@/lib/tasks/priority'

export const metadata = { title: 'Team Tasks — Ber Wilson Intelligence' }

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string }>
}) {
  const { task: initialOpenTaskId } = await searchParams
  const supabase = createAdminClient()
  const viewer = await getViewer()

  // Which deals and conversations have moved lately — the board ranks and
  // colours by it. Read here rather than in the client component because it is
  // two queries over thread_links, and every row's tier is computed from the
  // one answer. An error means the ranking is unavailable, which the board says
  // out loud rather than greying every row as if nothing were live.
  const live = await loadLiveContext()

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

  // Protected projects leave the board entirely — their tasks AND their entry in
  // the project picker. A task title is written by whoever typed it and routinely
  // names the deal ("Send Hill AFB the bonding letter"), so the tag is not the
  // only thing that would carry.
  // The Google Sheet this board publishes to (My Drive / Ber Intelligence /
  // Task Board / Ber Wilson Tasks, owned by moose@). Read from
  // `task_sheet_state` rather than written into the source, because the
  // workbook is CREATED by the platform on first sync — the id is not
  // configuration (see the 20261011000010 migration). A failed select or a
  // sync that has never run yields null, which renders no button.
  const { data: sheetState } = await supabase
    .from('task_sheet_state')
    .select('spreadsheet_id, spreadsheet_url')
    .maybeSingle()
  const sheetUrl =
    !viewer || viewer.isAdmin || viewer.role === 'executive'
      ? (sheetState?.spreadsheet_url ??
        (sheetState?.spreadsheet_id
          ? `https://docs.google.com/spreadsheets/d/${sheetState.spreadsheet_id}`
          : null))
      : null

  const hidden = await viewerHiddenProjectIds()
  boardTasks = dropHidden(boardTasks, (t) => t.project_id, hidden)
  projectOptions = dropHidden(projectOptions, (p) => p.id, hidden)

  return (
    <TeamTaskBoard
      initialTasks={boardTasks}
      teamMembers={(members ?? []) as TeamMember[]}
      projects={projectOptions}
      opportunities={opportunityOptions}
      investors={investorOptions}
      objectives={visibleObjectives}
      showWeeklyReport={!viewer || viewer.isAdmin}
      sheetUrl={sheetUrl}
      initialOpenTaskId={initialOpenTaskId ?? null}
      liveRecordIds={[...live.liveRecordIds]}
      liveCommitmentIds={[...live.liveCommitmentIds]}
      liveError={live.error}
    />
  )
}
