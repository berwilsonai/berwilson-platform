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
  INVESTMENT_TARGET_KINDS,
  INVESTMENT_TARGET_LABELS,
} from '@/lib/utils/investors'
import { FIELD_CONTROL_SM_CLASS } from '@/lib/utils/field-classes'
import { cn } from '@/lib/utils'

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
  // `w-auto` out of the shared class on purpose: these sit in a `flex-wrap`
  // row, and the shared control is `w-full` because most controls fill a form
  // grid cell. A 100% flex item on a wrapping row stacks one per line.
  const selectClass = cn(FIELD_CONTROL_SM_CLASS, 'w-auto')

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
        {/* ⚠ GENERATED FROM THE SHARED MEMBER LIST. A hand-written pair here
            offered no way to filter to SPV commitments at all, and the page
            treated the unknown value as "all" rather than refusing it. */}
        {INVESTMENT_TARGET_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {INVESTMENT_TARGET_LABELS[kind]}
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
