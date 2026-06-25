'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { Calendar, parseKey } from '@/components/ui/calendar'
import { cn } from '@/lib/utils'

interface DatePickerProps {
  /** YYYY-MM-DD or '' */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

function formatDisplay(value: string): string {
  const d = parseKey(value)
  if (!d) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Friendly date picker: a button showing the selected date that opens a month
 * calendar in a dropdown. Uses the outside-click pattern (matching
 * AssigneeInput) rather than a Popover primitive, so it has no extra deps.
 */
export function DatePicker({ value, onChange, placeholder = 'Pick a date', className }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const display = formatDisplay(value)

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'h-9 w-full inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 text-sm transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring',
          !display && 'text-muted-foreground',
          className,
        )}
      >
        <CalendarDays size={14} className="shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left truncate">{display || placeholder}</span>
        {value && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onChange('') }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Clear date"
          >
            <X size={14} />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-30 mt-1 rounded-lg border border-border bg-popover elev-2 animate-fade-in-up">
          <Calendar
            value={value}
            onSelect={(v) => { onChange(v); if (v) setOpen(false) }}
          />
        </div>
      )}
    </div>
  )
}
