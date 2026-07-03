import { CalendarDays } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import CalendarView from '@/components/calendar/CalendarView'
import { fetchOpenTasks } from '@/lib/tasks/queries'

export const metadata = { title: 'Calendar — Ber Wilson Intelligence' }

export default async function CalendarPage() {
  const supabase = createAdminClient()

  // Get upcoming milestones, action items, and compliance deadlines
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const sixtyDaysOut = new Date(now.getTime() + 60 * 86_400_000).toISOString()

  const [milestonesResult, complianceResult, dueTasks, bidsResult] = await Promise.all([
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
    // Open tasks with due dates in the window (tasks table = real task system)
    fetchOpenTasks(supabase, {
      dueAfter: thirtyDaysAgo.split('T')[0],
      dueBefore: sixtyDaysOut.split('T')[0],
    }),
    // Bid submission deadlines for active pre-award pursuits
    supabase
      .from('projects')
      .select('id, name, bid_due_date, stage')
      .in('status', ['active', 'on_hold'])
      .in('stage', ['pursuit', 'capture', 'bid'])
      .not('bid_due_date', 'is', null)
      .gte('bid_due_date', thirtyDaysAgo)
      .lte('bid_due_date', sixtyDaysOut)
      .order('bid_due_date', { ascending: true }),
  ])

  // Build calendar events
  type CalendarEvent = {
    id: string
    type: 'milestone' | 'compliance' | 'action' | 'bid'
    title: string
    date: string
    project_id: string
    project_name: string
    detail: string
    overdue: boolean
    completed: boolean
  }

  const events: CalendarEvent[] = []

  for (const b of bidsResult.data ?? []) {
    const proj = b as typeof b & { bid_due_date?: string | null }
    if (!proj.bid_due_date) continue
    events.push({
      id: `bid-${b.id}`,
      type: 'bid',
      title: `Bid due: ${b.name}`,
      date: proj.bid_due_date,
      project_id: b.id,
      project_name: b.name,
      detail: 'Proposal submission',
      overdue: new Date(proj.bid_due_date) < now,
      completed: false,
    })
  }

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

  for (const t of dueTasks) {
    if (!t.due_date) continue
    events.push({
      id: `task-${t.id}`,
      type: 'action',
      title: t.title,
      date: t.due_date,
      project_id: t.project_id ?? '',
      project_name: t.project_name ?? '—',
      detail: t.assignee ? `Owner: ${t.assignee}` : '',
      overdue: new Date(t.due_date) < now,
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
            Bid deadlines, milestones, compliance, and action items across all projects
          </p>
        </div>
      </div>

      <CalendarView events={events} />
    </div>
  )
}
