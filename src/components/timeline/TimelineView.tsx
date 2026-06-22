'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { GanttChart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STAGE_LABELS, STAGE_BADGE, formatValue } from '@/lib/utils/constants'
import type { ProjectStage } from '@/lib/supabase/types'

export type MarkerType = 'bid_due' | 'award' | 'ntp' | 'completion' | 'milestone'

export interface TimelineMarker {
  date: string
  type: MarkerType
  label: string
}

export interface TimelineRow {
  id: string
  name: string
  stage: ProjectStage
  estimatedValue: number | null
  markers: TimelineMarker[]
}

const MARKER_STYLE: Record<MarkerType, { dot: string; label: string }> = {
  bid_due: { dot: 'bg-red-500 ring-red-200', label: 'Bid Due' },
  award: { dot: 'bg-blue-500 ring-blue-200', label: 'Award' },
  ntp: { dot: 'bg-cyan-500 ring-cyan-200', label: 'NTP' },
  completion: { dot: 'bg-indigo-500 ring-indigo-200', label: 'Substantial Completion' },
  milestone: { dot: 'bg-amber-400 ring-amber-200', label: 'Milestone' },
}

const DAY = 86_400_000

function ts(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getTime()
}

function monthsBetween(start: number, end: number): { label: string; pct: number }[] {
  const out: { label: string; pct: number }[] = []
  const total = end - start
  const d = new Date(start)
  d.setDate(1)
  d.setMonth(d.getMonth() + 1) // first month boundary after start
  while (d.getTime() < end) {
    out.push({
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      pct: ((d.getTime() - start) / total) * 100,
    })
    d.setMonth(d.getMonth() + 1)
  }
  return out
}

export default function TimelineView({ rows }: { rows: TimelineRow[] }) {
  const [activeTypes, setActiveTypes] = useState<Set<MarkerType>>(
    new Set(['bid_due', 'award', 'ntp', 'completion', 'milestone'])
  )

  function toggleType(t: MarkerType) {
    setActiveTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  const { windowStart, windowEnd, months, todayPct, visibleRows } = useMemo(() => {
    const now = Date.now()
    const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()

    // Keep only markers of active types
    const filteredRows = rows
      .map((r) => ({ ...r, markers: r.markers.filter((m) => activeTypes.has(m.type)) }))
      .filter((r) => r.markers.length > 0)

    const allTs = filteredRows.flatMap((r) => r.markers.map((m) => ts(m.date)))
    const minMarker = allTs.length ? Math.min(...allTs) : todayStart
    const maxMarker = allTs.length ? Math.max(...allTs) : todayStart + 90 * DAY

    // Pad window so markers don't sit on the edge; always include today
    const start = Math.min(minMarker, todayStart) - 7 * DAY
    const end = Math.max(maxMarker, todayStart + 30 * DAY) + 14 * DAY
    const total = end - start

    // Sort rows by earliest visible marker
    const sorted = [...filteredRows].sort((a, b) => {
      const ea = Math.min(...a.markers.map((m) => ts(m.date)))
      const eb = Math.min(...b.markers.map((m) => ts(m.date)))
      return ea - eb
    })

    return {
      windowStart: start,
      windowEnd: end,
      months: monthsBetween(start, end),
      todayPct: ((now - start) / total) * 100,
      visibleRows: sorted,
    }
  }, [rows, activeTypes])

  const total = windowEnd - windowStart
  const pct = (dateStr: string) => ((ts(dateStr) - windowStart) / total) * 100

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <GanttChart size={18} className="text-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Portfolio Timeline</h1>
          <p className="text-xs text-muted-foreground">
            Every bid deadline and key date across the pipeline on one axis — spot the crunch weeks.
          </p>
        </div>
      </div>

      {/* Legend / filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(MARKER_STYLE) as MarkerType[]).map((t) => {
          const active = activeTypes.has(t)
          return (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                active ? 'border-border bg-background text-foreground' : 'border-border/50 bg-muted/30 text-muted-foreground/60'
              )}
            >
              <span className={cn('w-2.5 h-2.5 rounded-full ring-2', MARKER_STYLE[t].dot, !active && 'opacity-40')} />
              {MARKER_STYLE[t].label}
            </button>
          )
        })}
      </div>

      {visibleRows.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          No dated items to chart. Add bid due dates, award dates, or milestones to your projects.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <div className="min-w-[760px]">
            {/* Month axis */}
            <div className="relative h-7 border-b border-border bg-muted/20">
              <div className="absolute left-0 top-0 bottom-0 w-48 border-r border-border" />
              <div className="absolute left-48 right-0 top-0 bottom-0">
                {months.map((m, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 flex items-center"
                    style={{ left: `${m.pct}%` }}
                  >
                    <span className="text-[10px] text-muted-foreground -translate-x-1/2 whitespace-nowrap px-1">
                      {m.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Rows */}
            <div className="relative">
              {/* gridlines + today line spanning the chart area */}
              <div className="absolute left-48 right-0 top-0 bottom-0 pointer-events-none">
                {months.map((m, i) => (
                  <div key={i} className="absolute top-0 bottom-0 w-px bg-border/40" style={{ left: `${m.pct}%` }} />
                ))}
                {todayPct >= 0 && todayPct <= 100 && (
                  <div className="absolute top-0 bottom-0 w-px bg-red-400/70" style={{ left: `${todayPct}%` }}>
                    <span className="absolute -top-0 left-1 text-[9px] font-semibold text-red-500">today</span>
                  </div>
                )}
              </div>

              {visibleRows.map((row) => (
                <div key={row.id} className="relative flex items-stretch border-b border-border/60 last:border-b-0 hover:bg-muted/20 transition-colors">
                  {/* Row label */}
                  <div className="w-48 shrink-0 border-r border-border px-3 py-2.5">
                    <Link href={`/projects/${row.id}`} className="block group">
                      <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {row.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={cn('inline-flex items-center rounded px-1 py-0.5 text-[9px] font-medium ring-1 ring-inset', STAGE_BADGE[row.stage])}>
                          {STAGE_LABELS[row.stage]}
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">{formatValue(row.estimatedValue)}</span>
                      </div>
                    </Link>
                  </div>

                  {/* Track */}
                  <div className="relative flex-1 my-2.5 mx-0">
                    <div className="absolute left-0 right-0 top-1/2 h-px bg-border/50" />
                    {row.markers.map((m, i) => (
                      <div
                        key={i}
                        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 group/marker"
                        style={{ left: `${Math.max(0, Math.min(100, pct(m.date)))}%` }}
                      >
                        <span
                          className={cn(
                            'block rounded-full ring-2',
                            m.type === 'bid_due' ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5',
                            MARKER_STYLE[m.type].dot
                          )}
                        />
                        {/* Tooltip */}
                        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/marker:block z-20 whitespace-nowrap rounded bg-foreground text-background text-[10px] px-2 py-1 shadow-lg">
                          <span className="font-semibold">{MARKER_STYLE[m.type].label}:</span> {m.label}
                          <br />
                          {new Date(m.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
