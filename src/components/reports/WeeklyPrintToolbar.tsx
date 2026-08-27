'use client'

import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WeeklyPrintToolbarProps {
  /** Team members to scope the document to, plus the "everyone" option. */
  people: { id: string; name: string }[]
  selected: string | 'all'
}

/**
 * Screen-only controls for the weekly report: pick the scope (the whole company,
 * or one person's page — which is the thing that actually gets emailed), then
 * print. The browser's print dialog is the "Save as PDF" path, so there's no PDF
 * library to maintain. Mirrors the objectives PrintToolbar.
 */
export function WeeklyPrintToolbar({ people, selected }: WeeklyPrintToolbarProps) {
  return (
    // Opaque, not bg-white/95: a sticky bar keeps the report scrolling beneath
    // it, and at 95% the text underneath ghosted through and read as a
    // rendering overlap rather than a deliberate bar.
    <div className="print:hidden sticky top-0 z-10 border-b border-slate-200 bg-white">
      {/* One row even at 390px: the scope label and the long print verb are the
          two things that pushed this bar to three stacked rows on a phone. */}
      <div className="mx-auto max-w-3xl px-4 sm:px-8 py-2.5 flex items-center gap-2 sm:gap-3 flex-wrap">
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1.5 h-11 sm:h-9 text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft size={14} /> Tasks
        </Link>

        <div className="ml-auto flex items-center gap-2 min-w-0">
          <label htmlFor="scope" className="hidden sm:inline text-sm text-slate-500">
            Scope
          </label>
          {/* A plain link-list would overflow with a real team — a select stays compact. */}
          <select
            id="scope"
            defaultValue={selected}
            onChange={(e) => {
              const v = e.target.value
              window.location.href =
                v === 'all' ? '/reports/weekly/print' : `/reports/weekly/print?person=${v}`
            }}
            className={cn(
              'h-11 sm:h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900',
              'focus:outline-none focus:ring-2 focus:ring-slate-900/20',
            )}
          >
            <option value="all">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 whitespace-nowrap h-11 sm:h-9 px-3.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          <Printer size={15} />
          <span className="sm:hidden">Print</span>
          <span className="hidden sm:inline">Print / Save PDF</span>
        </button>
      </div>
    </div>
  )
}
