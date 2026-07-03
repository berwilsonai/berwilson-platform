/**
 * Attention engine — everything that's falling through the cracks:
 * - Overdue tasks (from the tasks table)
 * - Stale waiting-on items (older than 14 days with no follow-up)
 * - Approaching milestones with no recent activity
 * - Critical/blocker DD items with no resolution
 * - Compliance items expiring within 90 days
 * - Decisions with no follow-through
 * - Active cross-project dependency risks
 *
 * Consumed by GET /api/attention and the agent's get_attention_items tool
 * (which calls computeAttention() directly — no HTTP self-fetch).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchOpenTasks } from '@/lib/tasks/queries'

export interface AttentionItem {
  id: string
  category: 'overdue_action' | 'stale_waiting' | 'approaching_milestone' | 'critical_dd' | 'expiring_compliance' | 'stale_decision' | 'dependency_risk'
  urgency: number // 0-100, higher = more urgent
  title: string
  detail: string
  project_id: string | null
  project_name: string
  age_days: number
  due_date: string | null
  source_date: string
}

export interface AttentionSummary {
  total: number
  overdue_actions: number
  stale_waiting: number
  approaching_milestones: number
  critical_dd: number
  expiring_compliance: number
  stale_decisions: number
  dependency_risks: number
}

export async function computeAttention(): Promise<{ items: AttentionItem[]; summary: AttentionSummary }> {
  const supabase = createAdminClient()
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const items: AttentionItem[] = []

  // Parallel data fetch — tasks come from the real task system (tasks table)
  const [
    overdueTasks,
    { data: projects },
    { data: updates },
    { data: milestones },
    { data: ddItems },
    { data: complianceItems },
    { data: dependencies },
  ] = await Promise.all([
    fetchOpenTasks(supabase, { dueBefore: today }),
    supabase.from('projects').select('id, name').eq('status', 'active'),
    supabase
      .from('updates')
      .select('id, project_id, summary, waiting_on, decisions, created_at, projects(name)')
      .eq('review_state', 'approved')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('milestones')
      .select('id, label, stage, target_date, completed_at, project_id, projects(name)')
      .is('completed_at', null)
      .lte('target_date', new Date(now.getTime() + 30 * 86_400_000).toISOString().split('T')[0])
      .order('target_date'),
    supabase
      .from('dd_items')
      .select('id, category, item, severity, status, notes, project_id, created_at, projects(name)')
      .neq('status', 'resolved')
      .in('severity', ['critical', 'blocker']),
    supabase
      .from('compliance_items')
      .select('id, framework, requirement, status, due_date, project_id, projects(name)')
      .not('status', 'in', '("compliant","waived")')
      .lte('due_date', new Date(now.getTime() + 90 * 86_400_000).toISOString().split('T')[0])
      .order('due_date'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('project_dependencies')
      .select('id, upstream_project_id, downstream_project_id, dependency_type, description, severity, status, created_at')
      .eq('status', 'active')
      .in('severity', ['critical', 'blocker']),
  ])

  const projectName = (u: { projects: unknown }) =>
    (u.projects as { name: string } | null)?.name ?? 'Unknown'

  const projectMap: Record<string, string> = {}
  for (const p of projects ?? []) projectMap[p.id] = p.name

  type JsonWaitingOn = { text?: string; party?: string; since?: string }
  type JsonDecision = { text?: string; made_by?: string; date?: string }

  // 1. Overdue tasks (from the tasks table — the real task system)
  for (const t of overdueTasks) {
    if (!t.due_date || t.due_date >= today) continue // due today isn't overdue
    const ageDays = Math.floor((now.getTime() - new Date(t.due_date).getTime()) / 86_400_000)
    items.push({
      id: `task-${t.id}`,
      category: 'overdue_action',
      urgency: Math.min(100, 60 + ageDays * 2),
      title: t.title,
      detail: t.assignee ? `Assigned to ${t.assignee} · ${ageDays}d overdue` : `${ageDays}d overdue`,
      project_id: t.project_id,
      project_name: t.project_name ?? '—',
      age_days: ageDays,
      due_date: t.due_date,
      source_date: t.created_at ?? '',
    })
  }

  // 2. Stale waiting-on items (> 14 days since mentioned)
  for (const u of updates ?? []) {
    const waitingOn = (u.waiting_on ?? []) as JsonWaitingOn[]
    for (const item of waitingOn) {
      const sinceDate = item.since ? new Date(item.since) : new Date(u.created_at ?? '')
      const ageDays = Math.floor((now.getTime() - sinceDate.getTime()) / 86_400_000)
      if (ageDays < 14) continue

      items.push({
        id: `waiting-${u.id}-${item.text?.slice(0, 20)}`,
        category: 'stale_waiting',
        urgency: Math.min(100, 40 + ageDays),
        title: item.text ?? 'Waiting on unknown',
        detail: item.party ? `Waiting on ${item.party} · ${ageDays}d` : `${ageDays}d since flagged`,
        project_id: u.project_id,
        project_name: projectName(u),
        age_days: ageDays,
        due_date: null,
        source_date: item.since ?? u.created_at ?? '',
      })
    }
  }

  // 3. Approaching milestones (within 30 days or overdue)
  for (const m of milestones ?? []) {
    if (!m.target_date) continue
    const targetDate = new Date(m.target_date)
    const daysUntil = Math.floor((targetDate.getTime() - now.getTime()) / 86_400_000)
    const isOverdue = targetDate < now

    // Check if there's a recent update for this project
    const recentUpdate = (updates ?? []).find(
      u => u.project_id === m.project_id &&
        (now.getTime() - new Date(u.created_at ?? '').getTime()) < 14 * 86_400_000
    )

    // Only flag if overdue OR approaching with no recent activity
    if (!isOverdue && recentUpdate) continue

    items.push({
      id: `milestone-${m.id}`,
      category: 'approaching_milestone',
      urgency: isOverdue ? Math.min(100, 70 + Math.abs(daysUntil) * 2) : Math.max(30, 60 - daysUntil),
      title: m.label,
      detail: isOverdue
        ? `${Math.abs(daysUntil)}d overdue · ${m.stage} gate`
        : `${daysUntil}d away · ${m.stage} gate${!recentUpdate ? ' · No recent updates' : ''}`,
      project_id: m.project_id,
      project_name: projectName(m),
      age_days: isOverdue ? Math.abs(daysUntil) : 0,
      due_date: m.target_date,
      source_date: m.target_date,
    })
  }

  // 4. Critical/blocker DD items
  for (const dd of ddItems ?? []) {
    const ageDays = Math.floor((now.getTime() - new Date(dd.created_at ?? '').getTime()) / 86_400_000)
    items.push({
      id: `dd-${dd.id}`,
      category: 'critical_dd',
      urgency: dd.severity === 'blocker' ? 95 : 75,
      title: dd.item,
      detail: `${(dd.severity ?? 'info').toUpperCase()} · ${dd.category} · ${ageDays}d open`,
      project_id: dd.project_id,
      project_name: projectName(dd),
      age_days: ageDays,
      due_date: null,
      source_date: dd.created_at ?? '',
    })
  }

  // 5. Expiring compliance items
  for (const c of complianceItems ?? []) {
    if (!c.due_date) continue
    const dueDate = new Date(c.due_date)
    const daysUntil = Math.floor((dueDate.getTime() - now.getTime()) / 86_400_000)
    const isOverdue = c.due_date < today

    items.push({
      id: `comp-${c.id}`,
      category: 'expiring_compliance',
      urgency: isOverdue ? 85 : Math.max(20, 70 - daysUntil),
      title: `${c.framework}: ${c.requirement}`,
      detail: isOverdue
        ? `OVERDUE · ${c.status}`
        : `${daysUntil}d until due · ${c.status}`,
      project_id: c.project_id,
      project_name: projectName(c),
      age_days: isOverdue ? Math.abs(daysUntil) : 0,
      due_date: c.due_date,
      source_date: c.due_date,
    })
  }

  // 6. Stale decisions — decisions older than 14 days with no more recent update mentioning follow-through
  const seenDecisions = new Set<string>()
  for (const u of updates ?? []) {
    const decisions = (u.decisions ?? []) as JsonDecision[]
    for (const d of decisions) {
      if (!d.text) continue
      const key = `${u.project_id}-${d.text.slice(0, 50)}`
      if (seenDecisions.has(key)) continue
      seenDecisions.add(key)

      const decisionDate = d.date ? new Date(d.date) : new Date(u.created_at ?? '')
      const ageDays = Math.floor((now.getTime() - decisionDate.getTime()) / 86_400_000)
      if (ageDays < 14) continue

      // Check if any more recent update in same project mentions related keywords
      const decisionWords = d.text.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 3)
      const hasFollowUp = (updates ?? []).some(later => {
        if (later.project_id !== u.project_id) return false
        if (new Date(later.created_at ?? '') <= new Date(u.created_at ?? '')) return false
        const summary = later.summary ?? ''
        return decisionWords.some(w => summary.toLowerCase().includes(w))
      })

      if (hasFollowUp) continue

      items.push({
        id: `decision-${u.id}-${d.text.slice(0, 20)}`,
        category: 'stale_decision',
        urgency: Math.min(90, 35 + ageDays),
        title: d.text,
        detail: `Decision by ${d.made_by ?? 'unknown'} · ${ageDays}d ago · No follow-up detected`,
        project_id: u.project_id,
        project_name: projectName(u),
        age_days: ageDays,
        due_date: null,
        source_date: d.date ?? u.created_at ?? '',
      })
    }
  }

  // 7. Cross-project dependency risks
  for (const dep of dependencies ?? []) {
    const ageDays = Math.floor((now.getTime() - new Date(dep.created_at).getTime()) / 86_400_000)
    const upName = projectMap[dep.upstream_project_id] ?? 'Unknown'
    const downName = projectMap[dep.downstream_project_id] ?? 'Unknown'

    items.push({
      id: `dep-${dep.id}`,
      category: 'dependency_risk',
      urgency: dep.severity === 'blocker' ? 90 : 70,
      title: dep.description ?? `${upName} blocks ${downName}`,
      detail: `${dep.severity.toUpperCase()} · ${upName} → ${downName} · ${ageDays}d active`,
      project_id: dep.downstream_project_id,
      project_name: downName,
      age_days: ageDays,
      due_date: null,
      source_date: dep.created_at,
    })
  }

  // Sort by urgency descending
  items.sort((a, b) => b.urgency - a.urgency)

  // Summary counts
  const summary: AttentionSummary = {
    total: items.length,
    overdue_actions: items.filter(i => i.category === 'overdue_action').length,
    stale_waiting: items.filter(i => i.category === 'stale_waiting').length,
    approaching_milestones: items.filter(i => i.category === 'approaching_milestone').length,
    critical_dd: items.filter(i => i.category === 'critical_dd').length,
    expiring_compliance: items.filter(i => i.category === 'expiring_compliance').length,
    stale_decisions: items.filter(i => i.category === 'stale_decision').length,
    dependency_risks: items.filter(i => i.category === 'dependency_risk').length,
  }

  return { items, summary }
}
