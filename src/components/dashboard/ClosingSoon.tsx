import Link from 'next/link'
import { Timer, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  bidDueLabel, bidDueColor, daysUntilDate, formatValue, pwinBadge,
} from '@/lib/utils/constants'

export interface ClosingSoonItem {
  id: string
  name: string
  bid_due_date: string | null
  estimated_value: number | null
  win_probability: number | null
}

/** Upcoming and overdue bid deadlines across the portfolio, soonest first. */
export default function ClosingSoon({ items }: { items: ClosingSoonItem[] }) {
  if (items.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-card elev-1 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <Timer size={13} className="text-muted-foreground" />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Closing Soon
        </span>
        <span className="ml-auto text-xs text-muted-foreground tnum">{items.length}</span>
      </div>

      <div className="divide-y divide-border">
        {items.map((p) => {
          const days = daysUntilDate(p.bid_due_date)
          const urgent = days != null && days <= 7
          return (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="group flex items-center gap-3 px-4 py-2.5 hover:bg-accent/60 transition-colors"
            >
              <div
                className={cn(
                  'flex flex-col items-center justify-center w-12 shrink-0 rounded-md py-1 ring-1 ring-inset',
                  urgent || (days != null && days < 0)
                    ? 'bg-red-50 dark:bg-red-950/40 ring-red-200 dark:ring-red-800/60'
                    : days != null && days <= 21
                      ? 'bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-800/60'
                      : 'bg-slate-50 dark:bg-slate-950/40 ring-slate-200 dark:ring-slate-800/60'
                )}
              >
                <span className={cn('text-sm font-bold tnum leading-none', bidDueColor(p.bid_due_date))}>
                  {days != null && days < 0 ? `+${Math.abs(days)}` : days}
                </span>
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground mt-0.5">
                  {days != null && days < 0 ? 'over' : 'days'}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
                  {p.name}
                </p>
                <p className={cn('text-[11px] font-medium', bidDueColor(p.bid_due_date))}>
                  {bidDueLabel(p.bid_due_date)}
                </p>
              </div>

              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <span className="text-xs font-semibold tnum text-foreground">
                  {formatValue(p.estimated_value)}
                </span>
                {p.win_probability != null && (
                  <span
                    className={cn(
                      'inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold ring-1 ring-inset tnum',
                      pwinBadge(p.win_probability)
                    )}
                  >
                    {p.win_probability}%
                  </span>
                )}
              </div>
              <ArrowRight size={12} className="text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
