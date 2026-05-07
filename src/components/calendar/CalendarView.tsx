'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Flag, Shield, CheckSquare, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CalendarEvent {
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

interface CalendarViewProps {
  events: CalendarEvent[]
}

const TYPE_CONFIG = {
  milestone: { icon: Flag, label: 'Milestone', color: 'text-blue-600', bg: 'bg-blue-50', ring: 'ring-blue-200' },
  compliance: { icon: Shield, label: 'Compliance', color: 'text-violet-600', bg: 'bg-violet-50', ring: 'ring-violet-200' },
  action: { icon: CheckSquare, label: 'Action Item', color: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-200' },
}

type FilterType = 'all' | 'milestone' | 'compliance' | 'action'

function groupByWeek(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const groups = new Map<string, CalendarEvent[]>()

  for (const event of events) {
    const d = new Date(event.date)
    // Get Monday of the week
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(d.setDate(diff))
    const weekKey = monday.toISOString().split('T')[0]

    if (!groups.has(weekKey)) groups.set(weekKey, [])
    groups.get(weekKey)!.push(event)
  }

  return groups
}

function formatWeekLabel(mondayStr: string): string {
  const monday = new Date(mondayStr)
  const sunday = new Date(monday.getTime() + 6 * 86_400_000)

  const now = new Date()
  const thisMonday = new Date(now)
  const day = thisMonday.getDay()
  thisMonday.setDate(thisMonday.getDate() - day + (day === 0 ? -6 : 1))
  thisMonday.setHours(0, 0, 0, 0)

  const diffDays = Math.round((monday.getTime() - thisMonday.getTime()) / 86_400_000)

  let prefix = ''
  if (diffDays === 0) prefix = 'This Week — '
  else if (diffDays === 7) prefix = 'Next Week — '
  else if (diffDays === -7) prefix = 'Last Week — '

  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${prefix}${fmt(monday)} – ${fmt(sunday)}`
}

export default function CalendarView({ events }: CalendarViewProps) {
  const [filter, setFilter] = useState<FilterType>('all')

  const filtered = filter === 'all' ? events : events.filter(e => e.type === filter)
  const weeks = groupByWeek(filtered)

  const today = new Date().toISOString().split('T')[0]

  // Count by type for filter badges
  const counts = {
    all: events.length,
    milestone: events.filter(e => e.type === 'milestone').length,
    compliance: events.filter(e => e.type === 'compliance').length,
    action: events.filter(e => e.type === 'action').length,
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['all', 'milestone', 'compliance', 'action'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            {f === 'all' ? 'All' : TYPE_CONFIG[f].label}
            <span className="ml-1 opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* Events by week */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <CalendarEmpty />
          <p className="text-sm text-muted-foreground mt-2">No upcoming events</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(weeks.entries()).map(([weekKey, weekEvents]) => (
            <div key={weekKey}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {formatWeekLabel(weekKey)}
              </h3>

              <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
                {weekEvents.map((event) => {
                  const config = TYPE_CONFIG[event.type]
                  const Icon = config.icon
                  const eventDate = event.date

                  return (
                    <Link
                      key={event.id}
                      href={event.type === 'milestone' ? `/projects/${event.project_id}/milestones` : `/projects/${event.project_id}`}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors',
                        event.completed && 'opacity-50'
                      )}
                    >
                      {/* Date */}
                      <div className={cn(
                        'shrink-0 w-10 text-center',
                        eventDate < today && !event.completed ? 'text-red-600' : 'text-muted-foreground'
                      )}>
                        <p className="text-xs font-mono">
                          {new Date(eventDate).toLocaleDateString('en-US', { month: 'short' })}
                        </p>
                        <p className="text-lg font-bold leading-none">
                          {new Date(eventDate).getDate()}
                        </p>
                      </div>

                      {/* Type badge */}
                      <span className={cn(
                        'shrink-0 mt-1 w-5 h-5 rounded flex items-center justify-center ring-1 ring-inset',
                        config.bg, config.ring
                      )}>
                        <Icon size={11} className={config.color} />
                      </span>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'text-sm font-medium text-foreground',
                          event.completed && 'line-through'
                        )}>
                          {event.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {event.project_name}
                          {event.detail && ` · ${event.detail}`}
                        </p>
                      </div>

                      {/* Status badges */}
                      {event.overdue && !event.completed && (
                        <span className="shrink-0 text-[10px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded ring-1 ring-red-200">
                          Overdue
                        </span>
                      )}
                      {event.completed && (
                        <span className="shrink-0 text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded ring-1 ring-emerald-200">
                          Done
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CalendarEmpty() {
  return (
    <svg className="mx-auto w-12 h-12 text-muted-foreground/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}
