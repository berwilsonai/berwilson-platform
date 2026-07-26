'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { X } from 'lucide-react'
import {
  STEEL_STAGES,
  STEEL_STAGE_LABELS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
} from '@/lib/utils/steel'

interface SteelFiltersProps {
  stage: string
  source: string
  sales: string
  salespeople: { id: string; name: string }[]
}

export default function SteelFilters({ stage, source, sales, salespeople }: SteelFiltersProps) {
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

  const hasFilters = stage || source || sales
  const selectClass =
    'h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select value={stage} onChange={(e) => setParam('stage', e.target.value)} className={selectClass}>
        <option value="">All Stages</option>
        {STEEL_STAGES.map((s) => (
          <option key={s} value={s}>
            {STEEL_STAGE_LABELS[s]}
          </option>
        ))}
      </select>

      <select value={source} onChange={(e) => setParam('source', e.target.value)} className={selectClass}>
        <option value="">All Sources</option>
        {LEAD_SOURCES.map((s) => (
          <option key={s} value={s}>
            {LEAD_SOURCE_LABELS[s]}
          </option>
        ))}
      </select>

      <select value={sales} onChange={(e) => setParam('sales', e.target.value)} className={selectClass}>
        <option value="">All Salespeople</option>
        {salespeople.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
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
