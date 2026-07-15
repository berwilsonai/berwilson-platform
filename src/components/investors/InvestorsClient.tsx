'use client'

import Link from 'next/link'
import { Flame, User, Building2, CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Investor } from '@/lib/supabase/types'
import { formatValue, formatDate } from '@/lib/utils/constants'
import {
  investorType,
  investorStage,
  interestLevel,
  isOffPipeline,
  isLenderType,
  isPastDate,
  INVESTOR_TYPE_LABELS,
  INVESTOR_TYPE_BADGE,
  INVESTOR_TYPE_BORDER,
  INVESTOR_STAGE_LABELS,
  INVESTOR_STAGE_BADGE,
  INTEREST_LEVEL_LABELS,
  INTEREST_LEVEL_BADGE,
} from '@/lib/utils/investors'

/** Investor + money rollups computed server-side from their investments. */
export interface InvestorCardData {
  investor: Investor
  indicated: number
  committed: number
  funded: number
  /** Human-readable target names, e.g. "Ber Wilson (parent)", project names. */
  targets: string[]
  isOrganization: boolean
}

function checkRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null
  if (min != null && max != null) return `${formatValue(min)}–${formatValue(max)}`
  if (min != null) return `${formatValue(min)}+`
  return `up to ${formatValue(max)}`
}

export default function InvestorsClient({ items }: { items: InvestorCardData[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map(({ investor, indicated, committed, funded, targets, isOrganization }) => {
        const t = investorType(investor.investor_type)
        const s = investorStage(investor.stage)
        const heat = interestLevel(investor.interest_level)
        const range = checkRange(investor.check_size_min, investor.check_size_max)
        const nextOverdue = isPastDate(investor.next_step_date) && !isOffPipeline(investor.stage)
        // Lead with the strongest number they've put on the table
        const money = funded > 0 ? { label: 'Funded', value: funded }
          : committed > 0 ? { label: 'Committed', value: committed }
          : indicated > 0 ? { label: 'Indicated', value: indicated }
          : null

        return (
          <Link
            key={investor.id}
            href={`/investors/${investor.id}`}
            className={cn(
              'group block rounded-lg border border-border border-l-[3px] bg-card p-4 elev-1 lift transition-colors',
              INVESTOR_TYPE_BORDER[t]
            )}
          >
            {/* Header: stage + interest */}
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', INVESTOR_STAGE_BADGE[s])}>
                {INVESTOR_STAGE_LABELS[s]}
              </span>
              <span className={cn('inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', INTEREST_LEVEL_BADGE[heat])}>
                {heat === 'hot' && <Flame size={11} />}
                {INTEREST_LEVEL_LABELS[heat]}
              </span>
            </div>

            {/* Name */}
            <h3 className="flex items-start gap-1.5 text-sm font-semibold leading-snug text-foreground group-hover:text-primary transition-colors">
              {isOrganization
                ? <Building2 size={14} className="shrink-0 mt-0.5 text-muted-foreground/70" />
                : <User size={14} className="shrink-0 mt-0.5 text-muted-foreground/70" />}
              <span className="line-clamp-2">{investor.name}</span>
            </h3>

            {/* Type + check size */}
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
              <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', INVESTOR_TYPE_BADGE[t])}>
                {INVESTOR_TYPE_LABELS[t]}
              </span>
              {isLenderType(investor.investor_type) && (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-border">
                  Lender (debt)
                </span>
              )}
              {range && <span className="tnum">Checks {range}</span>}
            </div>

            {/* Targets */}
            {targets.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {targets.slice(0, 3).map((name) => (
                  <span key={name} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground truncate max-w-[180px]">
                    {name}
                  </span>
                ))}
                {targets.length > 3 && (
                  <span className="text-[11px] text-muted-foreground">+{targets.length - 3} more</span>
                )}
              </div>
            )}

            {/* Footer: money */}
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
              {money ? (
                <span className="text-sm font-semibold tnum text-foreground">
                  {formatValue(money.value)}
                  <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{money.label}</span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">No commitments yet</span>
              )}
            </div>

            {/* Next step */}
            {(investor.next_step || investor.next_step_date) && (
              <div
                className={cn(
                  'mt-2 flex items-center gap-1 text-[11px] truncate',
                  nextOverdue ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground/80'
                )}
              >
                <CalendarClock size={11} className="shrink-0" />
                <span className="truncate">
                  {investor.next_step ? `Next: ${investor.next_step}` : `Next step ${formatDate(investor.next_step_date)}`}
                  {investor.next_step && investor.next_step_date ? ` — ${formatDate(investor.next_step_date)}` : ''}
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
