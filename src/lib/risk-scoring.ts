/**
 * Risk scoring engine — computes a 0–100 risk score per project.
 *
 * Factors:
 *  - Critical/blocker DD items: 20 pts each (max 40)
 *  - Warning DD items: 5 pts each (max 15)
 *  - Overdue milestones: 10 pts each (max 20)
 *  - Stale data (no update in 14+ days): up to 15 pts
 *  - Overdue compliance items: 5 pts each (max 10)
 *
 * Score interpretation:
 *  0–20: Low risk (green)
 *  21–40: Moderate risk (amber)
 *  41–60: Elevated risk (orange)
 *  61+: High risk (red)
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RiskBreakdown {
  critical_risks: number
  warning_risks: number
  overdue_milestones: number
  stale_data_days: number
  overdue_compliance: number
}

export interface ProjectRiskScore {
  project_id: string
  project_name: string
  score: number
  breakdown: RiskBreakdown
  trend: 'improving' | 'stable' | 'deteriorating' | 'new'
  previous_score: number | null
}

export async function computeRiskScores(): Promise<ProjectRiskScore[]> {
  const supabase = createAdminClient()
  const today = new Date().toISOString().split('T')[0]

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name')
    .eq('status', 'active')

  if (!projects?.length) return []

  const projectIds = projects.map(p => p.id)

  // Fetch all risk factors in parallel
  const [ddResult, milestonesResult, updatesResult, complianceResult, prevScoresResult] = await Promise.all([
    supabase
      .from('dd_items')
      .select('project_id, severity')
      .in('project_id', projectIds)
      .neq('status', 'resolved'),
    supabase
      .from('milestones')
      .select('project_id, target_date')
      .in('project_id', projectIds)
      .is('completed_at', null)
      .lt('target_date', today),
    supabase
      .from('updates')
      .select('project_id, created_at')
      .in('project_id', projectIds)
      .eq('review_state', 'approved')
      .order('created_at', { ascending: false }),
    supabase
      .from('compliance_items')
      .select('project_id, due_date, status')
      .in('project_id', projectIds)
      .not('status', 'in', '("compliant","waived")')
      .lt('due_date', today),
    // Get previous scores for trend calculation (table may not be in generated types yet)
    (supabase as unknown as SupabaseClient)
      .from('risk_scores')
      .select('project_id, score')
      .in('project_id', projectIds)
      .order('computed_at', { ascending: false }),
  ])

  const ddItems = ddResult.data ?? []
  const overdueMilestones = milestonesResult.data ?? []
  const allUpdates = updatesResult.data ?? []
  const overdueCompliance = complianceResult.data ?? []
  const prevScores = (prevScoresResult.data ?? []) as Array<{ project_id: string; score: number }>

  // Build previous score map (most recent per project)
  const prevScoreMap: Record<string, number> = {}
  for (const ps of prevScores) {
    if (!(ps.project_id in prevScoreMap)) {
      prevScoreMap[ps.project_id] = ps.score
    }
  }

  // Latest update date per project
  const latestUpdateMap: Record<string, string> = {}
  for (const u of allUpdates) {
    if (u.project_id && !(u.project_id in latestUpdateMap)) {
      latestUpdateMap[u.project_id] = u.created_at!
    }
  }

  const results: ProjectRiskScore[] = []

  for (const project of projects) {
    const pid = project.id

    // DD items
    const criticalCount = ddItems.filter(d => d.project_id === pid && (d.severity === 'critical' || d.severity === 'blocker')).length
    const warningCount = ddItems.filter(d => d.project_id === pid && d.severity === 'watch').length

    // Overdue milestones
    const overdueMs = overdueMilestones.filter(m => m.project_id === pid).length

    // Stale data
    const latestUpdate = latestUpdateMap[pid]
    const staleDays = latestUpdate
      ? Math.floor((Date.now() - new Date(latestUpdate).getTime()) / 86_400_000)
      : 30

    // Overdue compliance
    const overdueComp = overdueCompliance.filter(c => c.project_id === pid).length

    // Calculate score
    const criticalPts = Math.min(criticalCount * 20, 40)
    const warningPts = Math.min(warningCount * 5, 15)
    const milestonePts = Math.min(overdueMs * 10, 20)
    const stalePts = staleDays > 14 ? Math.min((staleDays - 14) * 1, 15) : 0
    const compliancePts = Math.min(overdueComp * 5, 10)

    const score = Math.min(criticalPts + warningPts + milestonePts + stalePts + compliancePts, 100)

    // Trend
    const prev = prevScoreMap[pid]
    let trend: ProjectRiskScore['trend'] = 'new'
    if (prev !== undefined) {
      const diff = score - prev
      if (diff > 5) trend = 'deteriorating'
      else if (diff < -5) trend = 'improving'
      else trend = 'stable'
    }

    results.push({
      project_id: pid,
      project_name: project.name,
      score,
      breakdown: {
        critical_risks: criticalCount,
        warning_risks: warningCount,
        overdue_milestones: overdueMs,
        stale_data_days: staleDays,
        overdue_compliance: overdueComp,
      },
      trend,
      previous_score: prev ?? null,
    })
  }

  // Sort by score descending (highest risk first)
  results.sort((a, b) => b.score - a.score)

  return results
}

/**
 * Persist computed scores to the risk_scores table.
 */
export async function persistRiskScores(scores: ProjectRiskScore[]): Promise<void> {
  if (scores.length === 0) return
  const supabase = createAdminClient()

  // risk_scores table may not be in generated types yet
  await (supabase as unknown as SupabaseClient).from('risk_scores').insert(
    scores.map(s => ({
      project_id: s.project_id,
      score: s.score,
      breakdown: s.breakdown,
    }))
  )
}
