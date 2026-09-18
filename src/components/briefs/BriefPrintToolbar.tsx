'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowLeft, Printer } from 'lucide-react'
import ReadAloudButton from '@/components/shared/ReadAloudButton'

/**
 * Screen-only controls for the brief's print view. The browser's print dialog
 * is the "Save as PDF" path, so there is no PDF library to maintain — the same
 * choice the objectives and weekly-report print views make.
 */
export function BriefPrintToolbar({ projectId, text }: { projectId: string; text: string }) {
  return (
    <div className="print:hidden sticky top-0 z-10 border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-3xl px-8 py-3 flex items-center gap-3 flex-wrap">
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft size={14} /> Project
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <ReadAloudButton
            text={text}
            iconSize={14}
            className="h-9 px-3 rounded-lg border border-slate-200 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          />
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
          >
            <Printer size={15} /> Print / Save PDF
          </button>
        </div>
      </div>
    </div>
  )
}

/** Today's date for the document header — client-side so server lint stays quiet. */
export function PreparedDate() {
  const [today] = useState(() =>
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  )
  return <span suppressHydrationWarning>{today}</span>
}

/**
 * A dark-mode session would otherwise print a dark document. Strips the dark
 * class for the lifetime of this tab and restores it on unmount.
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
