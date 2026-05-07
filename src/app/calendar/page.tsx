import { CalendarDays } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import CalendarView from '@/components/calendar/CalendarView'

export const metadata = { title: 'Calendar — Ber Wilson Intelligence' }

export default async function CalendarPage() {
  const supabase = createAdminClient()

  // Get upcoming milestones, action items, and compliance deadlines
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const sixtyDaysOut = new Date(now.getTime() + 60 * 86_400_000).toISOString()

  const [milestonesResult, complianceResult, updatesResult] = await Promise.all([
    supabase
      .from('milestones')
      .select('id, label, stage, target_date, completed_at, project_id, project:projects(id, name, sector)')
      .gte('target_date', thirtyDaysAgo)
      .lte('target_date', sixtyDaysOut)
      .order('target_date', { ascending: true }),
    supabase
      .from('compliance_items')
      .select('id, framework, requirement, status, due_date, project_id, project:projects(id, name)')
      .not('status', 'in', '("compliant","waived")')
      .gte('due_date', thirtyDaysAgo)
      .lte('due_date', sixtyDaysOut)
      .order('due_date', { ascending: true }),
    // Get approved updates with action items that have due dates
    supabase
      .from('updates')
      .select('id, project_id, action_items, project:projects(id, name)')
      .eq('review_state', 'approved')
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  type ActionItemWithDue = {
    text: string
    assignee?: string
    due_date?: string
    completed?: boolean
  }

  // Extract action items with due dates
  const actionItems: Array<{
    text: string
    assignee: string | null
    due_date: string
    project_id: string
    project_name: string
  }> = []

  for (const update of updatesResult.data ?? []) {
    const items = (update.action_items ?? []) as ActionItemWithDue[]
    for (const item of items) {
      if (item.due_date && !item.completed) {
        const dueDate = new Date(item.due_date)
        if (dueDate >= new Date(thirtyDaysAgo) && dueDate <= new Date(sixtyDaysOut)) {
          actionItems.push({
            text: item.text,
            assignee: item.assignee ?? null,
            due_date: item.due_date,
            project_id: update.project_id!,
            project_name: (update.project as unknown as { name: string })?.name ?? 'Unknown',
          })
        }
      }
    }
  }

  // Build calendar events
  type CalendarEvent = {
    id: string
    type: 'milestone' | 'compliance' | 'action'
    title: string
    date: string
    project_id: string
    project_name: string
    detail: string
    overdue: boolean
    completed: boolean
  }

  const events: CalendarEvent[] = []

  for (const m of milestonesResult.data ?? []) {
    if (!m.target_date) continue
    events.push({
      id: `ms-${m.id}`,
      type: 'milestone',
      title: m.label,
      date: m.target_date,
      project_id: m.project_id,
      project_name: (m.project as unknown as { name: string })?.name ?? 'Unknown',
      detail: `${m.stage} gate`,
      overdue: !m.completed_at && new Date(m.target_date) < now,
      completed: !!m.completed_at,
    })
  }

  for (const c of complianceResult.data ?? []) {
    if (!c.due_date) continue
    events.push({
      id: `comp-${c.id}`,
      type: 'compliance',
      title: `${c.framework}: ${c.requirement}`,
      date: c.due_date,
      project_id: c.project_id!,
      project_name: (c.project as unknown as { name: string })?.name ?? 'Unknown',
      detail: c.status ?? 'pending',
      overdue: new Date(c.due_date) < now,
      completed: false,
    })
  }

  for (const a of actionItems) {
    events.push({
      id: `act-${a.due_date}-${a.text.slice(0, 20)}`,
      type: 'action',
      title: a.text,
      date: a.due_date,
      project_id: a.project_id,
      project_name: a.project_name,
      detail: a.assignee ? `Owner: ${a.assignee}` : '',
      overdue: new Date(a.due_date) < now,
      completed: false,
    })
  }

  // Sort by date
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
          <CalendarDays size={16} className="text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Portfolio Calendar</h1>
          <p className="text-xs text-muted-foreground">
            Milestones, deadlines, and action items across all projects
          </p>
        </div>
      </div>

      <CalendarView events={events} />
    </div>
  )
}
