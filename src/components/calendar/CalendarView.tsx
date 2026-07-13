'use client'

import { useState, useEffect, type ElementType } from 'react'
import Link from 'next/link'
import { Flag, Shield, CheckSquare, Calendar, ExternalLink, Timer } from 'lucide-react'
import { cn } from '@/lib/utils'
import MeetingPrepButton from './MeetingPrepButton'

export interface CalendarEvent {
  id: string
  type: 'milestone' | 'compliance' | 'action' | 'meeting' | 'bid'
  title: string
  date: string
  time?: string | null
  project_id: string
  project_name: string
  detail: string
  overdue: boolean
  completed: boolean
  webLink?: string | null
  attendees?: { name: string; email: string }[]
}

interface CalendarViewProps {
  events: CalendarEvent[]
}

const TYPE_CONFIG = {
  bid: { icon: Timer, label: 'Bid Due', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/40', ring: 'ring-red-200 dark:ring-red-800/60' },
  milestone: { icon: Flag, label: 'Milestone', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/40', ring: 'ring-blue-200 dark:ring-blue-800/60' },
  compliance: { icon: Shield, label: 'Compliance', color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/40', ring: 'ring-violet-200 dark:ring-violet-800/60' },
  action: { icon: CheckSquare, label: 'Action Item', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40', ring: 'ring-emerald-200 dark:ring-emerald-800/60' },
  meeting: { icon: Calendar, label: 'Meeting', color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-950/40', ring: 'ring-indigo-200 dark:ring-indigo-800/60' },
}

type FilterType = 'all' | 'milestone' | 'compliance' | 'action' | 'meeting' | 'bid'

function groupByWeek(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const groups = new Map<string, CalendarEvent[]>()

  for (const event of events) {
    const d = new Date(event.date)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(d)
    monday.setDate(diff)
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

export default function CalendarView({ events: serverEvents }: CalendarViewProps) {
  const [filter, setFilter] = useState<FilterType>('all')
  const [outlookEvents, setOutlookEvents] = useState<CalendarEvent[]>([])
  const [outlookWarning, setOutlookWarning] = useState<string | null>(null)

  // Fetch Outlook calendar events client-side
  useEffect(() => {
    async function loadOutlookEvents() {
      try {
        const now = new Date()
        const start = new Date(now.getTime() - 7 * 86_400_000).toISOString()
        const end = new Date(now.getTime() + 60 * 86_400_000).toISOString()

        const res = await fetch(`/api/calendar/events?start=${start}&end=${end}`)
        if (!res.ok) return

        const data = await res.json() as {
          events: {
            id: string
            subject: string
            start: string
            end: string
            location: string | null
            organizer: string | null
            attendees: { name: string; email: string; response: string }[]
            isAllDay: boolean
            webLink: string
          }[]
          warning?: string
        }

        if (data.warning) {
          setOutlookWarning(data.warning)
        }

        const mapped: CalendarEvent[] = data.events.map(e => {
          const startDate = new Date(e.start)
          const timeStr = e.isAllDay ? null : startDate.toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit',
          })
          const attendeeNames = e.attendees.slice(0, 3).map(a => a.name).join(', ')
          const moreCount = e.attendees.length > 3 ? ` +${e.attendees.length - 3}` : ''

          return {
            id: `outlook-${e.id}`,
            type: 'meeting' as const,
            title: e.subject,
            date: startDate.toISOString().split('T')[0],
            time: timeStr,
            project_id: '',
            project_name: e.organizer ?? '',
            detail: [
              timeStr,
              e.location,
              attendeeNames ? `${attendeeNames}${moreCount}` : null,
            ].filter(Boolean).join(' · '),
            overdue: false,
            completed: startDate < new Date(),
            webLink: e.webLink,
            attendees: e.attendees.map(a => ({ name: a.name, email: a.email })),
          }
        })

        setOutlookEvents(mapped)
      } catch {
        // Non-fatal — calendar just won't show meetings
      }
    }

    loadOutlookEvents()
  }, [])

  // Merge server events + outlook events
  const allEvents = [...serverEvents, ...outlookEvents].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )

  const filtered = filter === 'all' ? allEvents : allEvents.filter(e => e.type === filter)
  const weeks = groupByWeek(filtered)

  const today = new Date().toISOString().split('T')[0]

  const counts = {
    all: allEvents.length,
    bid: allEvents.filter(e => e.type === 'bid').length,
    milestone: allEvents.filter(e => e.type === 'milestone').length,
    compliance: allEvents.filter(e => e.type === 'compliance').length,
    action: allEvents.filter(e => e.type === 'action').length,
    meeting: allEvents.filter(e => e.type === 'meeting').length,
  }

  return (
    <div className="space-y-4">
      {/* Outlook warning */}
      {outlookWarning && (
        <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 rounded-md ring-1 ring-amber-200 dark:ring-amber-800/60">
          {outlookWarning}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['all', 'bid', 'meeting', 'milestone', 'compliance', 'action'] as const).map((f) => (
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
                  const isMeeting = event.type === 'meeting'
                  const href = isMeeting
                    ? (event.webLink ?? '#')
                    : event.type === 'milestone'
                      ? `/projects/${event.project_id}/milestones`
                      : `/projects/${event.project_id}`

                  const wrapperProps = isMeeting && event.webLink
                    ? { href, target: '_blank', rel: 'noopener noreferrer' }
                    : { href }

                  const Wrapper: ElementType = isMeeting && event.webLink ? 'a' : Link

                  return (
                    <Wrapper
                      key={event.id}
                      {...wrapperProps}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors',
                        event.completed && event.type !== 'meeting' && 'opacity-50'
                      )}
                    >
                      {/* Date */}
                      <div className={cn(
                        'shrink-0 w-10 text-center',
                        eventDate < today && !event.completed && event.type !== 'meeting' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
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
                          event.completed && event.type !== 'meeting' && 'line-through'
                        )}>
                          {event.title}
                          {isMeeting && event.webLink && (
                            <ExternalLink size={10} className="inline ml-1 text-muted-foreground" />
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {event.project_name}
                          {event.detail && ` · ${event.detail}`}
                        </p>
                      </div>

                      {/* Meeting prep button */}
                      {isMeeting && !event.completed && event.attendees && event.attendees.length > 0 && (
                        <MeetingPrepButton
                          subject={event.title}
                          date={event.date}
                          attendees={event.attendees}
                        />
                      )}

                      {/* Status badges */}
                      {event.overdue && !event.completed && (
                        <span className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-1.5 py-0.5 rounded ring-1 ring-red-200 dark:ring-red-800/60">
                          Overdue
                        </span>
                      )}
                      {event.completed && event.type !== 'meeting' && (
                        <span className="shrink-0 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded ring-1 ring-emerald-200 dark:ring-emerald-800/60">
                          Done
                        </span>
                      )}
                    </Wrapper>
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
