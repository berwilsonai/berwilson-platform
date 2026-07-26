'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Flag } from 'lucide-react'
import { DatePicker } from '@/components/ui/date-picker'
import { cn } from '@/lib/utils'

interface Props {
  dealId: string
  nextStep: string | null
  nextStepDate: string | null
  /** Amber the field when the (open) deal's next-step date has passed. */
  overdue?: boolean
}

/**
 * Inline "next step" editor at the top of the deal detail page. Saves the text
 * on blur / Enter and the date on change via the same PATCH the stage pill uses
 * (next_step / next_step_date are already patchable). The text flows straight
 * to the /steel tile cards, which render "Next: …".
 */
export default function SteelNextStepControl({ dealId, nextStep, nextStepDate, overdue }: Props) {
  const router = useRouter()
  const [value, setValue] = useState(nextStep ?? '')
  const [date, setDate] = useState(nextStepDate ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function save(patch: Record<string, string | null>) {
    setStatus('saving')
    try {
      const res = await fetch(`/api/steel/deals/${dealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        setStatus('idle')
        return
      }
      setStatus('saved')
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setStatus('idle'), 1500)
      router.refresh()
    } catch {
      setStatus('idle')
    }
  }

  function commitText() {
    const trimmed = value.trim()
    if (trimmed === (nextStep ?? '')) return
    save({ next_step: trimmed || null })
  }

  function commitDate(next: string) {
    setDate(next)
    if (next === (nextStepDate ?? '')) return
    save({ next_step_date: next || null })
  }

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        overdue
          ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10'
          : 'border-primary/30 bg-primary/5'
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span
          className={cn(
            'flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold',
            overdue ? 'text-amber-700 dark:text-amber-400' : 'text-primary'
          )}
        >
          <Flag size={12} />
          Next Step{overdue && ' — Overdue'}
        </span>
        {status === 'saving' && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
        {status === 'saved' && (
          <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            <Check size={12} /> Saved
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          placeholder="The single next action…"
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <DatePicker
          value={date}
          onChange={commitDate}
          placeholder="Due date"
          className="h-9 w-full text-sm sm:w-44"
        />
      </div>
    </div>
  )
}
