'use client'

import { CheckCircle2, AlertTriangle, Clock, ClipboardList, ShieldAlert, TrendingUp } from 'lucide-react'

interface HealthPanelProps {
  activeProjects: number
  pipelineValue: number
  pendingReview: number
  overdueCount: number
  criticalDdCount: number
  expiringCertsCount: number
}

function formatValue(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

function computeHealthScore(critical: number, overdue: number, review: number, expiring: number): number {
  const score =
    100 -
    Math.min(critical * 15, 45) -
    Math.min(overdue * 8, 32) -
    Math.min(review * 3, 15) -
    Math.min(expiring * 5, 10)
  return Math.max(0, Math.min(100, score))
}

function scoreColor(score: number) {
  if (score >= 85) return { stroke: '#10b981', text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Excellent' }
  if (score >= 70) return { stroke: '#3b82f6', text: 'text-blue-600', bg: 'bg-blue-50', label: 'Good' }
  if (score >= 50) return { stroke: '#f59e0b', text: 'text-amber-600', bg: 'bg-amber-50', label: 'At Risk' }
  return { stroke: '#ef4444', text: 'text-red-600', bg: 'bg-red-50', label: 'Critical' }
}

function HealthRing({ score }: { score: number }) {
  const r = 32
  const circumference = 2 * Math.PI * r
  const progress = (score / 100) * circumference
  const colors = scoreColor(score)

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-[84px] h-[84px] flex items-center justify-center">
        <svg viewBox="0 0 80 80" className="absolute inset-0 w-full h-full -rotate-90">
          <circle cx="40" cy="40" r={r} fill="none" stroke="#e5e7eb" strokeWidth="7" />
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={colors.stroke}
            strokeWidth="7"
            strokeDasharray={`${progress} ${circumference - progress}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
        <div className="flex flex-col items-center leading-none">
          <span className={`text-2xl font-bold ${colors.text}`}>{score}</span>
          <span className="text-xs text-muted-foreground mt-0.5">/ 100</span>
        </div>
      </div>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>
        {colors.label}
      </span>
    </div>
  )
}

function AlertRow({
  icon: Icon,
  label,
  count,
  dotColor,
  textColor,
  barColor,
  maxBar,
}: {
  icon: React.ElementType
  label: string
  count: number
  dotColor: string
  textColor: string
  barColor: string
  maxBar: number
}) {
  const barWidth = maxBar > 0 ? Math.min((count / maxBar) * 100, 100) : 0

  return (
    <div className="flex items-center gap-2">
      <Icon size={11} className={count > 0 ? textColor : 'text-muted-foreground/50'} />
      <span className={`text-xs w-24 shrink-0 ${count > 0 ? 'text-foreground' : 'text-muted-foreground/60'}`}>
        {label}
      </span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${count > 0 ? barColor : 'bg-emerald-300'}`}
          style={{ width: count > 0 ? `${barWidth}%` : '0%' }}
        />
      </div>
      <span className={`text-xs font-semibold tabular-nums w-4 text-right ${count > 0 ? textColor : 'text-muted-foreground/50'}`}>
        {count}
      </span>
    </div>
  )
}

export default function HealthPanel({
  activeProjects,
  pipelineValue,
  pendingReview,
  overdueCount,
  criticalDdCount,
  expiringCertsCount,
}: HealthPanelProps) {
  const score = computeHealthScore(criticalDdCount, overdueCount, pendingReview, expiringCertsCount)
  const totalAlerts = criticalDdCount + overdueCount + pendingReview + expiringCertsCount
  const maxBar = Math.max(criticalDdCount, overdueCount, pendingReview, expiringCertsCount, 1)

  // Stacked bar segments (proportional widths)
  const segments = [
    { value: criticalDdCount, color: 'bg-red-500' },
    { value: overdueCount, color: 'bg-orange-400' },
    { value: pendingReview, color: 'bg-amber-300' },
    { value: expiringCertsCount, color: 'bg-yellow-300' },
  ].filter((s) => s.value > 0)

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
        <TrendingUp size={13} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Portfolio Health
        </span>
        {totalAlerts === 0 && (
          <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600 font-medium">
            <CheckCircle2 size={11} />
            All Clear
          </span>
        )}
        {totalAlerts > 0 && (
          <span className="ml-auto text-xs text-amber-600 font-medium">
            {totalAlerts} item{totalAlerts !== 1 ? 's' : ''} need attention
          </span>
        )}
      </div>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-[auto_1fr_auto_auto] gap-5 items-center">

        {/* Health Ring */}
        <HealthRing score={score} />

        {/* Divider */}
        <div className="hidden sm:block w-px self-stretch bg-border" />

        {/* Alert breakdown */}
        <div className="space-y-2 min-w-[200px]">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Alert Breakdown
          </p>
          <AlertRow
            icon={ShieldAlert}
            label="Critical DD"
            count={criticalDdCount}
            dotColor="text-red-600"
            textColor="text-red-600"
            barColor="bg-red-500"
            maxBar={maxBar}
          />
          <AlertRow
            icon={Clock}
            label="Overdue"
            count={overdueCount}
            dotColor="text-orange-600"
            textColor="text-orange-600"
            barColor="bg-orange-400"
            maxBar={maxBar}
          />
          <AlertRow
            icon={ClipboardList}
            label="In Review"
            count={pendingReview}
            dotColor="text-amber-600"
            textColor="text-amber-600"
            barColor="bg-amber-400"
            maxBar={maxBar}
          />
          <AlertRow
            icon={AlertTriangle}
            label="Cert Expiry"
            count={expiringCertsCount}
            dotColor="text-yellow-600"
            textColor="text-yellow-600"
            barColor="bg-yellow-400"
            maxBar={maxBar}
          />

          {/* Stacked bar summary */}
          <div className="pt-1">
            <div className="flex h-2 rounded-full overflow-hidden gap-px">
              {segments.length === 0 ? (
                <div className="flex-1 bg-emerald-400 rounded-full" />
              ) : (
                segments.map((s, i) => (
                  <div
                    key={i}
                    className={`${s.color} transition-all duration-500`}
                    style={{ flex: s.value }}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px self-stretch bg-border" />

        {/* Pipeline value + project count */}
        <div className="flex flex-col gap-3 min-w-[110px]">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Pipeline Value
            </p>
            <p className="text-3xl font-bold text-foreground mt-1">
              {pipelineValue > 0 ? formatValue(pipelineValue) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Active Projects
            </p>
            <p className="text-3xl font-bold text-foreground mt-1">{activeProjects}</p>
          </div>
        </div>

      </div>
    </div>
  )
}
