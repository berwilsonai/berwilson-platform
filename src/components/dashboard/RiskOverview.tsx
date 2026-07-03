'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Shield, TrendingUp, TrendingDown, Minus, ArrowRight } from 'lucide-react'

interface RiskScore {
  project_id: string
  project_name: string
  score: number
  trend: 'improving' | 'stable' | 'deteriorating' | 'new'
  breakdown: {
    critical_risks: number
    overdue_milestones: number
    stale_data_days: number
    overdue_compliance: number
  }
}

function scoreColor(score: number): string {
  if (score <= 20) return 'text-emerald-600 dark:text-emerald-400'
  if (score <= 40) return 'text-amber-600 dark:text-amber-400'
  if (score <= 60) return 'text-orange-600 dark:text-orange-400'
  return 'text-red-600 dark:text-red-400'
}

function scoreBg(score: number): string {
  if (score <= 20) return 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-800/60'
  if (score <= 40) return 'bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-800/60'
  if (score <= 60) return 'bg-orange-50 dark:bg-orange-950/40 ring-orange-200 dark:ring-orange-800/60'
  return 'bg-red-50 dark:bg-red-950/40 ring-red-200 dark:ring-red-800/60'
}

function scoreLabel(score: number): string {
  if (score <= 20) return 'Low'
  if (score <= 40) return 'Moderate'
  if (score <= 60) return 'Elevated'
  return 'High'
}

const TrendIcon = ({ trend }: { trend: RiskScore['trend'] }) => {
  switch (trend) {
    case 'improving': return <TrendingDown size={10} className="text-emerald-500 dark:text-emerald-400" />
    case 'deteriorating': return <TrendingUp size={10} className="text-red-500 dark:text-red-400" />
    case 'stable': return <Minus size={10} className="text-slate-400" />
    default: return null
  }
}

export default function RiskOverview() {
  const [scores, setScores] = useState<RiskScore[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/risk-scores')
      .then(r => r.json())
      .then((data: { scores?: RiskScore[] }) => setScores(data.scores ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading || scores.length === 0) return null

  // Only show if there are notable risks
  const notableScores = scores.filter(s => s.score > 20)
  if (notableScores.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-card elev-1 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <Shield size={13} className="text-muted-foreground" />
        <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Portfolio Risk</h2>
      </div>

      <div className="divide-y divide-border">
        {notableScores.slice(0, 5).map((s) => (
          <Link
            key={s.project_id}
            href={`/projects/${s.project_id}`}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
          >
            <span className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${scoreBg(s.score)} ${scoreColor(s.score)}`}>
              {s.score}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{s.project_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {scoreLabel(s.score)} risk
                {s.breakdown.critical_risks > 0 && ` · ${s.breakdown.critical_risks} critical`}
                {s.breakdown.overdue_milestones > 0 && ` · ${s.breakdown.overdue_milestones} overdue`}
              </p>
            </div>
            <TrendIcon trend={s.trend} />
            <ArrowRight size={12} className="text-muted-foreground shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  )
}
