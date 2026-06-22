import { createAdminClient } from '@/lib/supabase/admin'
import TimelineView, { type TimelineRow, type TimelineMarker } from '@/components/timeline/TimelineView'
import type { ProjectStage } from '@/lib/supabase/types'

export const metadata = { title: 'Timeline — Ber Wilson Intelligence' }

export default async function TimelinePage() {
  const supabase = createAdminClient()

  const [{ data: projects }, { data: milestones }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, stage, estimated_value, bid_due_date, award_date, ntp_date, substantial_completion_date')
      .in('status', ['active', 'on_hold'])
      .order('name'),
    supabase
      .from('milestones')
      .select('id, label, target_date, project_id, completed_at')
      .is('completed_at', null)
      .not('target_date', 'is', null),
  ])

  // Group open milestones by project
  const msByProject = new Map<string, { label: string; target_date: string }[]>()
  for (const m of milestones ?? []) {
    if (!m.target_date) continue
    const arr = msByProject.get(m.project_id) ?? []
    arr.push({ label: m.label, target_date: m.target_date })
    msByProject.set(m.project_id, arr)
  }

  const rows: TimelineRow[] = []
  for (const p of projects ?? []) {
    const markers: TimelineMarker[] = []
    const proj = p as typeof p & { bid_due_date?: string | null }
    if (proj.bid_due_date) markers.push({ date: proj.bid_due_date, type: 'bid_due', label: 'Proposal submission' })
    if (p.award_date) markers.push({ date: p.award_date, type: 'award', label: 'Contract award' })
    if (p.ntp_date) markers.push({ date: p.ntp_date, type: 'ntp', label: 'Notice to proceed' })
    if (p.substantial_completion_date)
      markers.push({ date: p.substantial_completion_date, type: 'completion', label: 'Substantial completion' })
    for (const m of msByProject.get(p.id) ?? []) {
      markers.push({ date: m.target_date, type: 'milestone', label: m.label })
    }

    if (markers.length === 0) continue
    rows.push({
      id: p.id,
      name: p.name,
      stage: (p.stage ?? 'pursuit') as ProjectStage,
      estimatedValue: p.estimated_value,
      markers,
    })
  }

  return <TimelineView rows={rows} />
}
