'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { Calendar, parseKey, toKey } from '@/components/ui/calendar'
import { cn } from '@/lib/utils'

interface DatePickerProps {
  /** YYYY-MM-DD or '' (controlled mode) */
  value?: string
  onChange?: (value: string) => void
  /** Initial value for uncontrolled mode (YYYY-MM-DD); pair with `name` in server-action forms */
  defaultValue?: string | null
  /** When set, a hidden input carries the YYYY-MM-DD value for form submission */
  name?: string
  id?: string
  placeholder?: string
  className?: string
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

function formatDisplay(value: string): string {
  const d = parseKey(value)
  if (!d) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function resolveYear(raw: string | undefined): number {
  if (!raw) return new Date().getFullYear()
  const n = Number(raw)
  return raw.length <= 2 ? 2000 + n : n
}

function monthFromName(raw: string): number | null {
  const needle = raw.toLowerCase()
  if (needle.length < 3) return null
  const idx = MONTH_NAMES.findIndex((m) => m.startsWith(needle))
  return idx === -1 ? null : idx + 1
}

function buildKey(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return null
  const d = new Date(year, month - 1, day)
  // Reject overflow like Feb 31 (Date silently rolls it into March)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return toKey(d)
}

/**
 * Parse hand-typed dates. Accepts YYYY-MM-DD, M/D/YYYY, M/D/YY, M/D
 * (current year), M-D-YYYY, "Jul 10 2026", "July 10, 2026", "10 Jul 2026".
 * Returns YYYY-MM-DD, '' for empty input, or null when unparseable.
 */
function parseTyped(input: string): string | null {
  const text = input.trim()
  if (!text) return ''

  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return buildKey(Number(m[1]), Number(m[2]), Number(m[3]))

  m = text.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2}|\d{4}))?$/)
  if (m) return buildKey(resolveYear(m[3]), Number(m[1]), Number(m[2]))

  m = text.match(/^([a-zA-Z]+)\.?\s+(\d{1,2})(?:(?:,|\s)\s*(\d{2}|\d{4}))?$/)
  if (m) {
    const month = monthFromName(m[1])
    return month ? buildKey(resolveYear(m[3]), month, Number(m[2])) : null
  }

  m = text.match(/^(\d{1,2})\s+([a-zA-Z]+)\.?(?:(?:,|\s)\s*(\d{2}|\d{4}))?$/)
  if (m) {
    const month = monthFromName(m[2])
    return month ? buildKey(resolveYear(m[3]), month, Number(m[1])) : null
  }

  return null
}

/**
 * Friendly date picker: a text field you can type any common date format into
 * (committed on Enter or blur), with a month-calendar dropdown for mouse
 * selection. Works controlled (value/onChange) or inside plain forms
 * (name/defaultValue → hidden YYYY-MM-DD input). Outside-click pattern, no
 * extra deps.
 */
export function DatePicker({
  value,
  onChange,
  defaultValue,
  name,
  id,
  placeholder = 'Pick or type a date',
  className,
}: DatePickerProps) {
  const isControlled = value !== undefined
  const [internal, setInternal] = useState(defaultValue ?? '')
  const current = isControlled ? value : internal

  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function setValue(next: string) {
    if (!isControlled) setInternal(next)
    onChange?.(next)
  }

  function commitText() {
    const parsed = parseTyped(text)
    if (parsed !== null && parsed !== current) setValue(parsed)
    // Unparseable input reverts to the last valid date on next render
  }

  const display = focused ? text : formatDisplay(current)

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={cn(
          'h-9 w-full flex items-center gap-2 rounded-md border border-input bg-background px-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring',
          className,
        )}
      >
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setOpen((o) => !o)
            inputRef.current?.focus()
          }}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Open calendar"
        >
          <CalendarDays size={14} />
        </button>
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={display}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={(e) => {
            setFocused(true)
            setOpen(true)
            setText(formatDisplay(current))
            e.target.select()
          }}
          onBlur={() => {
            commitText()
            setFocused(false)
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitText()
              setFocused(false)
              setOpen(false)
              inputRef.current?.blur()
            } else if (e.key === 'Escape') {
              setText(formatDisplay(current))
              setOpen(false)
            }
          }}
          className="flex-1 min-w-0 bg-transparent focus:outline-none placeholder:text-muted-foreground"
        />
        {current && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setValue('')
              setText('')
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear date"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {name && <input type="hidden" name={name} value={current} />}

      {open && (
        <div className="absolute z-30 mt-1 rounded-lg border border-border bg-popover elev-2 animate-fade-in-up">
          <Calendar
            value={current}
            onSelect={(v) => {
              setValue(v)
              setText(formatDisplay(v))
              if (v) {
                setOpen(false)
                setFocused(false)
                inputRef.current?.blur()
              }
            }}
          />
        </div>
      )}
    </div>
  )
}
