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
  if (score <= 20) return 'text-emerald-600'
  if (score <= 40) return 'text-amber-600'
  if (score <= 60) return 'text-orange-600'
  return 'text-red-600'
}

function scoreBg(score: number): string {
  if (score <= 20) return 'bg-emerald-50 ring-emerald-200'
  if (score <= 40) return 'bg-amber-50 ring-amber-200'
  if (score <= 60) return 'bg-orange-50 ring-orange-200'
  return 'bg-red-50 ring-red-200'
}

function scoreLabel(score: number): string {
  if (score <= 20) return 'Low'
  if (score <= 40) return 'Moderate'
  if (score <= 60) return 'Elevated'
  return 'High'
}

const TrendIcon = ({ trend }: { trend: RiskScore['trend'] }) => {
  switch (trend) {
    case 'improving': return <TrendingDown size={10} className="text-emerald-500" />
    case 'deteriorating': return <TrendingUp size={10} className="text-red-500" />
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
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Shield size={14} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Portfolio Risk</h2>
      </div>

      <div className="divide-y divide-border">
        {notableScores.slice(0, 5).map((s) => (
          <Link
            key={s.project_id}
            href={`/projects/${s.project_id}`}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
          >
            <span className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${scoreBg(s.score)} ${scoreColor(s.score)}`}>
              {s.score}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{s.project_name}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
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
