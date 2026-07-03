'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft, Printer } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  OBJECTIVE_BUCKETS,
  OBJECTIVE_BUCKET_LABELS,
  type ObjectiveBucket,
} from '@/lib/utils/objectives'

/**
 * Screen-only controls for the print view: pick which section to export
 * (everything or a single bucket), then print — the browser's print dialog
 * is the "Save as PDF" path, so there's no PDF library to maintain.
 */
export function PrintToolbar({ bucket }: { bucket: ObjectiveBucket | 'all' }) {
  const options: { value: ObjectiveBucket | 'all'; label: string }[] = [
    { value: 'all', label: 'Everything' },
    ...OBJECTIVE_BUCKETS.map((b) => ({ value: b, label: OBJECTIVE_BUCKET_LABELS[b] })),
  ]

  return (
    <div className="print:hidden sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto max-w-3xl px-8 py-3 flex items-center gap-3 flex-wrap">
        <Link
          href="/objectives"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft size={14} /> Board
        </Link>

        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-sm ml-auto">
          {options.map((opt, i) => (
            <Link
              key={opt.value}
              href={opt.value === 'all' ? '/objectives/print' : `/objectives/print?bucket=${opt.value}`}
              className={cn(
                'px-3 py-1.5 transition-colors',
                i > 0 && 'border-l border-slate-200',
                bucket === opt.value
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50',
              )}
            >
              {opt.label}
            </Link>
          ))}
        </div>

        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          <Printer size={15} /> Print / Save PDF
        </button>
      </div>
    </div>
  )
}

/** Today's date for the document header — client-side so server lint stays quiet. */
export function PreparedDate() {
  const [today] = useState(() =>
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  )
  return <span suppressHydrationWarning>{today}</span>
}
