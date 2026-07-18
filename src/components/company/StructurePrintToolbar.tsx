'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowLeft, Printer } from 'lucide-react'
import { cn } from '@/lib/utils'

export type PrintDepth = 'high' | 'entities' | 'full'

const DEPTH_OPTIONS: { value: PrintDepth; label: string }[] = [
  { value: 'high', label: 'High level' },
  { value: 'entities', label: 'Entities' },
  { value: 'full', label: 'Everything' },
]

/**
 * Screen-only controls for the print view: pick the export altitude, then
 * print — the browser's print dialog is the "Save as PDF" path (objectives
 * print pattern; no PDF library).
 */
export function StructurePrintToolbar({ depth }: { depth: PrintDepth }) {
  return (
    <div className="print:hidden sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl px-8 py-3 flex items-center gap-3 flex-wrap">
        <Link
          href="/company/structure"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft size={14} /> Structure
        </Link>

        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-sm ml-auto">
          {DEPTH_OPTIONS.map((opt, i) => (
            <Link
              key={opt.value}
              href={`/company/structure/print?depth=${opt.value}`}
              className={cn(
                'px-3 py-1.5 transition-colors',
                i > 0 && 'border-l border-slate-200',
                depth === opt.value
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

/**
 * The chart renders with theme tokens; a dark-mode session would print a dark
 * document. This strips the dark class for the lifetime of the print tab
 * (opened in its own tab) and restores it on unmount.
 */
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
