'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Clock,
  Flag,
  Shield,
  Gavel,
  GitBranch,
  CheckCircle2,
  RefreshCw,
  Filter,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface AttentionItem {
  id: string
  category: string
  urgency: number
  title: string
  detail: string
  project_id: string | null
  project_name: string
  age_days: number
  due_date: string | null
  source_date: string
}

interface Summary {
  total: number
  overdue_actions: number
  stale_waiting: number
  approaching_milestones: number
  critical_dd: number
  expiring_compliance: number
  stale_decisions: number
  dependency_risks: number
}

const CATEGORY_CONFIG: Record<string, {
  icon: typeof AlertTriangle
  label: string
  color: string
  bg: string
  ring: string
}> = {
  overdue_action: { icon: CheckCircle2, label: 'Overdue Action', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/40', ring: 'ring-red-200 dark:ring-red-800/60' },
  stale_waiting: { icon: Clock, label: 'Stale Waiting', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40', ring: 'ring-amber-200 dark:ring-amber-800/60' },
  approaching_milestone: { icon: Flag, label: 'Milestone', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/40', ring: 'ring-blue-200 dark:ring-blue-800/60' },
  critical_dd: { icon: AlertTriangle, label: 'DD Blocker', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/40', ring: 'ring-red-200 dark:ring-red-800/60' },
  expiring_compliance: { icon: Shield, label: 'Compliance', color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/40', ring: 'ring-violet-200 dark:ring-violet-800/60' },
  stale_decision: { icon: Gavel, label: 'Decision', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-950/40', ring: 'ring-orange-200 dark:ring-orange-800/60' },
  dependency_risk: { icon: GitBranch, label: 'Dependency', color: 'text-pink-600 dark:text-pink-400', bg: 'bg-pink-50 dark:bg-pink-950/40', ring: 'ring-pink-200 dark:ring-pink-800/60' },
}

type FilterCategory = 'all' | string

export default function AttentionList() {
  const [items, setItems] = useState<AttentionItem[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterCategory>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/attention')
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const data = await res.json() as { items: AttentionItem[]; summary: Summary }
      setItems(data.items)
      setSummary(data.summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = filter === 'all' ? items : items.filter(i => i.category === filter)

  const filterButtons: { key: FilterCategory; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: summary?.total ?? 0 },
    { key: 'overdue_action', label: 'Overdue', count: summary?.overdue_actions ?? 0 },
    { key: 'stale_waiting', label: 'Waiting On', count: summary?.stale_waiting ?? 0 },
    { key: 'approaching_milestone', label: 'Milestones', count: summary?.approaching_milestones ?? 0 },
    { key: 'critical_dd', label: 'DD Items', count: summary?.critical_dd ?? 0 },
    { key: 'expiring_compliance', label: 'Compliance', count: summary?.expiring_compliance ?? 0 },
    { key: 'stale_decision', label: 'Decisions', count: summary?.stale_decisions ?? 0 },
    { key: 'dependency_risk', label: 'Dependencies', count: summary?.dependency_risks ?? 0 },
  ]

  return (
    <div className="space-y-4">
      {/* Urgency summary bar */}
      {summary && summary.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Critical', count: items.filter(i => i.urgency >= 80).length, color: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 ring-red-200 dark:ring-red-800/60' },
            { label: 'High', count: items.filter(i => i.urgency >= 60 && i.urgency < 80).length, color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-800/60' },
            { label: 'Medium', count: items.filter(i => i.urgency >= 40 && i.urgency < 60).length, color: 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/40 ring-yellow-200 dark:ring-yellow-800/60' },
            { label: 'Low', count: items.filter(i => i.urgency < 40).length, color: 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/40 ring-slate-200 dark:ring-slate-800/60' },
          ].map(({ label, count, color }) => (
            <div key={label} className={cn('rounded-lg ring-1 ring-inset px-3 py-2', color)}>
              <p className="text-2xl font-bold tabular-nums">{count}</p>
              <p className="text-xs font-medium">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Filter size={13} className="text-muted-foreground mr-1" />
        {filterButtons.filter(f => f.count > 0 || f.key === 'all').map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'px-2 py-1 rounded text-xs font-medium transition-colors',
              filter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            {f.label}
            <span className="ml-1 opacity-70">{f.count}</span>
          </button>
        ))}
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto p-1.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Loading */}
      {loading && items.length === 0 && (
        <div className="space-y-3 animate-pulse">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-lg" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-16">
          <CheckCircle2 size={40} className="mx-auto text-emerald-400 mb-3" />
          <p className="text-sm font-medium text-foreground">Nothing falling through the cracks</p>
          <p className="text-xs text-muted-foreground mt-1">All action items, deadlines, and risks are under control</p>
        </div>
      )}

      {/* Items list */}
      {filtered.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
          {filtered.map((item) => {
            const config = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.overdue_action
            const Icon = config.icon

            return (
              <Link
                key={item.id}
                href={item.project_id ? `/projects/${item.project_id}` : '/dashboard'}
                className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                {/* Urgency bar */}
                <div className={cn(
                  'shrink-0 w-1 self-stretch rounded-full',
                  item.urgency >= 80 ? 'bg-red-500' :
                  item.urgency >= 60 ? 'bg-amber-500' :
                  item.urgency >= 40 ? 'bg-yellow-400' :
                  'bg-slate-300'
                )} />

                {/* Type icon */}
                <span className={cn(
                  'shrink-0 mt-0.5 w-6 h-6 rounded flex items-center justify-center ring-1 ring-inset',
                  config.bg, config.ring
                )}>
                  <Icon size={12} className={config.color} />
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-tight">
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {item.project_name} · {item.detail}
                  </p>
                </div>

                {/* Category badge */}
                <span className={cn(
                  'shrink-0 text-xs font-medium px-1.5 py-0.5 rounded ring-1 ring-inset',
                  config.bg, config.ring, config.color
                )}>
                  {config.label}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
