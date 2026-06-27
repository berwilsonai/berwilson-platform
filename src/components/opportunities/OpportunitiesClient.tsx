'use client'

import Link from 'next/link'
import { MapPin, Building2, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Opportunity } from '@/lib/supabase/types'
import { formatValue, formatDate, SECTOR_LABELS } from '@/lib/utils/constants'
import type { ProjectSector } from '@/lib/supabase/types'
import {
  oppType,
  oppStatus,
  oppPriority,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_TYPE_BADGE,
  OPPORTUNITY_TYPE_BORDER,
  OPPORTUNITY_STATUS_LABELS,
  OPPORTUNITY_STATUS_BADGE,
  OPPORTUNITY_PRIORITY_BADGE,
  OPPORTUNITY_PRIORITY_LABELS,
} from '@/lib/utils/opportunities'

interface OpportunitiesClientProps {
  opportunities: Opportunity[]
}

export default function OpportunitiesClient({ opportunities }: OpportunitiesClientProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {opportunities.map((opp) => {
        const t = oppType(opp.opp_type)
        const s = oppStatus(opp.status)
        const p = oppPriority(opp.priority)

        return (
          <Link
            key={opp.id}
            href={`/opportunities/${opp.id}`}
            className={cn(
              'group block rounded-lg border border-border border-l-[3px] bg-card p-4 elev-1 lift transition-colors',
              OPPORTUNITY_TYPE_BORDER[t]
            )}
          >
            {/* Header: type + status */}
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              <span
                className={cn(
                  'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                  OPPORTUNITY_TYPE_BADGE[t]
                )}
              >
                {OPPORTUNITY_TYPE_LABELS[t]}
              </span>
              <span
                className={cn(
                  'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                  OPPORTUNITY_STATUS_BADGE[s]
                )}
              >
                {OPPORTUNITY_STATUS_LABELS[s]}
              </span>
              {p === 'high' && (
                <span
                  className={cn(
                    'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                    OPPORTUNITY_PRIORITY_BADGE[p]
                  )}
                >
                  {OPPORTUNITY_PRIORITY_LABELS[p]}
                </span>
              )}
            </div>

            {/* Name */}
            <h3 className="text-sm font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
              {opp.name}
            </h3>

            {/* Objective preview */}
            {opp.objective && (
              <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 flex gap-1.5">
                <Target size={13} className="shrink-0 mt-0.5 text-muted-foreground/70" />
                <span>{opp.objective}</span>
              </p>
            )}

            {/* Meta row */}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {opp.target_name && (
                <span className="inline-flex items-center gap-1 truncate max-w-[160px]">
                  <Building2 size={12} className="shrink-0" />
                  <span className="truncate">{opp.target_name}</span>
                </span>
              )}
              {opp.location && (
                <span className="inline-flex items-center gap-1 truncate max-w-[140px]">
                  <MapPin size={12} className="shrink-0" />
                  <span className="truncate">{opp.location}</span>
                </span>
              )}
            </div>

            {/* Footer: value + sector + probability */}
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
              <span className="text-sm font-semibold tnum text-foreground">
                {formatValue(opp.estimated_value)}
              </span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {opp.sector && SECTOR_LABELS[opp.sector as ProjectSector] && (
                  <span>{SECTOR_LABELS[opp.sector as ProjectSector]}</span>
                )}
                {opp.probability != null && (
                  <span className="tnum font-medium">{opp.probability}%</span>
                )}
              </div>
            </div>

            {/* Next step / target date */}
            {(opp.next_step || opp.target_close_date) && (
              <div className="mt-2 text-[11px] text-muted-foreground/80 truncate">
                {opp.next_step
                  ? `Next: ${opp.next_step}`
                  : `Target close ${formatDate(opp.target_close_date)}`}
              </div>
            )}
          </Link>
        )
      })}
    </div>
  )
}
