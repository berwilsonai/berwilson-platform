'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Local YYYY-MM-DD (avoids UTC off-by-one from toISOString) */
function toKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseKey(value: string): Date | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

interface CalendarProps {
  /** Selected date as YYYY-MM-DD, or empty */
  value: string
  onSelect: (value: string) => void
  className?: string
}

export function Calendar({ value, onSelect, className }: CalendarProps) {
  const selected = parseKey(value)
  const todayKey = toKey(new Date())
  const [view, setView] = useState(() => selected ?? new Date())

  const year = view.getFullYear()
  const month = view.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (Date | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))

  return (
    <div className={cn('w-64 select-none p-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setView(new Date(year, month - 1, 1))}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-foreground tnum">
          {MONTHS[month]} {year}
        </span>
        <button
          type="button"
          onClick={() => setView(new Date(year, month + 1, 1))}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Weekday labels */}
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-muted-foreground/60 py-1">
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />
          const key = toKey(date)
          const isSelected = key === value
          const isToday = key === todayKey
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(key)}
              className={cn(
                'h-8 w-8 rounded-md text-sm tnum transition-colors flex items-center justify-center',
                isSelected
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : isToday
                    ? 'bg-muted text-foreground font-semibold ring-1 ring-inset ring-border'
                    : 'text-foreground hover:bg-muted',
              )}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={() => { onSelect(todayKey); setView(new Date()) }}
          className="text-xs font-medium text-primary hover:underline"
        >
          Today
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onSelect('')}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

export { toKey, parseKey }
