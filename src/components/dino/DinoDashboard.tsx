'use client'

import { useMemo, useState } from 'react'
import { revenueRollup, splitByPeriod, trendSettings, type RevenueRange } from '@/lib/utils/dino'
import RevenueRollup from './RevenueRollup'
import RevenueSplitBar from './RevenueSplitBar'
import RevenueLedger, { type DinoRevenueRow } from './RevenueLedger'
import PaymentSchedule, { type DinoPaymentRow } from './PaymentSchedule'
import DinoNotes, { type DinoNoteRow } from './DinoNotes'

interface Props {
  entries: DinoRevenueRow[]
  projects: { id: string; name: string }[]
  payments: DinoPaymentRow[]
  notes: DinoNoteRow[]
}

export default function DinoDashboard({ entries, projects, payments, notes }: Props) {
  const [range, setRange] = useState<RevenueRange>('ttm')

  const rollup = useMemo(() => revenueRollup(entries, range), [entries, range])
  const buckets = useMemo(() => {
    const { granularity, count } = trendSettings(range)
    return splitByPeriod(entries, granularity, count)
  }, [entries, range])

  return (
    <div className="space-y-5">
      <RevenueRollup rollup={rollup} range={range} onRangeChange={setRange} />

      <RevenueSplitBar buckets={buckets} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <RevenueLedger entries={entries} projects={projects} />
        </div>
        <div className="space-y-5">
          <PaymentSchedule payments={payments} />
          <DinoNotes notes={notes} />
        </div>
      </div>
    </div>
  )
}
