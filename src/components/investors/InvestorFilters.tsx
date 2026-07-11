'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { X } from 'lucide-react'
import {
  INVESTOR_TYPES,
  INVESTOR_TYPE_LABELS,
  INVESTOR_STAGES,
  INVESTOR_STAGE_LABELS,
  INTEREST_LEVELS,
  INTEREST_LEVEL_LABELS,
} from '@/lib/utils/investors'

interface InvestorFiltersProps {
  stage: string
  type: string
  interest: string
  target: string
}

export default function InvestorFilters({ stage, type, interest, target }: InvestorFiltersProps) {
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

  const hasFilters = stage || type || interest || target
  const selectClass =
    'h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select value={stage} onChange={(e) => setParam('stage', e.target.value)} className={selectClass}>
        <option value="">All Stages</option>
        {INVESTOR_STAGES.map((s) => (
          <option key={s} value={s}>
            {INVESTOR_STAGE_LABELS[s]}
          </option>
        ))}
      </select>

      <select value={type} onChange={(e) => setParam('type', e.target.value)} className={selectClass}>
        <option value="">All Types</option>
        {INVESTOR_TYPES.map((t) => (
          <option key={t} value={t}>
            {INVESTOR_TYPE_LABELS[t]}
          </option>
        ))}
      </select>

      <select value={interest} onChange={(e) => setParam('interest', e.target.value)} className={selectClass}>
        <option value="">All Interest</option>
        {INTEREST_LEVELS.map((l) => (
          <option key={l} value={l}>
            {INTEREST_LEVEL_LABELS[l]}
          </option>
        ))}
      </select>

      <select value={target} onChange={(e) => setParam('target', e.target.value)} className={selectClass}>
        <option value="">All Targets</option>
        <option value="company">Ber Wilson (parent)</option>
        <option value="project">Projects / SPVs</option>
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
