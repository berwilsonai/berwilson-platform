'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowLeft, Printer } from 'lucide-react'

/**
 * Screen-only controls for the steel quote document (hidden in print). The
 * browser print dialog is the "Save as PDF" path — no PDF library.
 */
export function SteelQuoteToolbar({ dealId }: { dealId: string }) {
  return (
    <div className="print:hidden sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto max-w-3xl px-8 py-3 flex items-center gap-3">
        <Link
          href={`/steel/${dealId}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft size={14} /> Deal
        </Link>
        <button
          onClick={() => window.print()}
          className="ml-auto inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          <Printer size={15} /> Print / Save PDF
        </button>
      </div>
    </div>
  )
}

/** Today's date, client-side so server lint stays quiet. */
export function QuoteDate() {
  const [today] = useState(() =>
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  )
  return <span suppressHydrationWarning>{today}</span>
}

/** A quote is a customer document — always print it light, even from a dark session. */
export function ForceLightTheme() {
  useEffect(() => {
    const el = document.documentElement
    const hadDark = el.classList.contains('dark')
    el.classList.remove('dark')
    return () => {
      if (hadDark) el.classList.add('dark')
    }
  }, [])
  return null
}
