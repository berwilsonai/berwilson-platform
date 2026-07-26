'use client'

import Link from 'next/link'
import { CalendarClock, Ruler, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SteelDeal } from '@/lib/supabase/types'
import { formatValue, formatDate } from '@/lib/utils/constants'
import { isPastDate } from '@/lib/utils/investors'
import {
  steelStage,
  leadSourceLabel,
  leadSourceBadge,
  isOpenStage,
  formatSqft,
  STEEL_STAGE_LABELS,
  STEEL_STAGE_BADGE,
  STEEL_STAGE_BORDER,
} from '@/lib/utils/steel'

/** Deal + salesperson name resolved server-side. */
export interface SteelDealCardData {
  deal: SteelDeal
  salesperson: string | null
}

export default function SteelDealsClient({ items }: { items: SteelDealCardData[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map(({ deal, salesperson }) => {
        const s = steelStage(deal.stage)
        const nextOverdue = isPastDate(deal.next_step_date) && isOpenStage(deal.stage)

        return (
          <Link
            key={deal.id}
            href={`/steel/${deal.id}`}
            className={cn(
              'group block rounded-lg border border-border border-l-[3px] bg-card p-4 elev-1 lift transition-colors',
              STEEL_STAGE_BORDER[s]
            )}
          >
            {/* Header: stage + lead source */}
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', STEEL_STAGE_BADGE[s])}>
                {STEEL_STAGE_LABELS[s]}
              </span>
              <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', leadSourceBadge(deal.lead_source))}>
                {leadSourceLabel(deal.lead_source)}
              </span>
            </div>

            {/* Name */}
            <h3 className="text-sm font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
              {deal.name}
            </h3>

            {/* Customer + building type */}
            {(deal.customer || deal.building_type) && (
              <p className="mt-1 text-xs text-muted-foreground truncate">
                {[deal.customer, deal.building_type].filter(Boolean).join(' · ')}
              </p>
            )}

            {/* Salesperson */}
            {salesperson && (
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                <UserRound size={11} className="shrink-0" />
                {salesperson}
              </p>
            )}

            {/* Footer: money + size */}
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
              {deal.value != null ? (
                <span className="text-sm font-semibold tnum text-foreground">{formatValue(deal.value)}</span>
              ) : (
                <span className="text-xs text-muted-foreground">No value yet</span>
              )}
              {deal.square_feet != null && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground tnum">
                  <Ruler size={11} className="shrink-0" />
                  {formatSqft(deal.square_feet)}
                  {deal.price_per_sqft != null && ` @ $${deal.price_per_sqft}`}
                </span>
              )}
            </div>

            {/* Next step */}
            {(deal.next_step || deal.next_step_date) && (
              <div
                className={cn(
                  'mt-2 flex items-center gap-1 text-[11px] truncate',
                  nextOverdue ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground/80'
                )}
              >
                <CalendarClock size={11} className="shrink-0" />
                <span className="truncate">
                  {deal.next_step ? `Next: ${deal.next_step}` : `Next step ${formatDate(deal.next_step_date)}`}
                  {deal.next_step && deal.next_step_date ? ` — ${formatDate(deal.next_step_date)}` : ''}
                  {nextOverdue && ' · overdue'}
                </span>
              </div>
            )}
          </Link>
        )
      })}
    </div>
  )
}
