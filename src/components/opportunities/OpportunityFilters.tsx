'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { X } from 'lucide-react'
import {
  OPPORTUNITY_TYPES,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_STATUS_LABELS,
} from '@/lib/utils/opportunities'

interface OpportunityFiltersProps {
  type: string
  status: string
}

export default function OpportunityFilters({ type, status }: OpportunityFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  const hasFilters = type || status

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={type}
        onChange={(e) => setParam('type', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">All Types</option>
        {OPPORTUNITY_TYPES.map((t) => (
          <option key={t} value={t}>
            {OPPORTUNITY_TYPE_LABELS[t]}
          </option>
        ))}
      </select>

      <select
        value={status}
        onChange={(e) => setParam('status', e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">All Statuses</option>
        {OPPORTUNITY_STATUSES.map((s) => (
          <option key={s} value={s}>
            {OPPORTUNITY_STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      {hasFilters && (
        <button
          onClick={() => router.push(pathname)}
          className="h-8 flex items-center gap-1 px-2.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={12} />
          Clear
        </button>
      )}
    </div>
  )
}
