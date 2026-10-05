'use client'

/**
 * The quick calc, reachable from anywhere.
 *
 * Follows AskBeAIDock: mounted once in the root layout, STAYS MOUNTED while
 * closed so a half-entered calculation survives closing it, and opened by a
 * keyboard shortcut or a window event so any header button can reach it.
 *
 * ⌘K is the command palette and ⌘J is Ask Ber AI, so this takes ⌘/ (slash,
 * which is also where a calculator's divide key lives).
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Calculator, ExternalLink, X } from 'lucide-react'
import QuickCalc from './QuickCalc'
import { EMPTY_SCRATCH } from '@/lib/economics/scratch'

export const QUICK_CALC_EVENT = 'open-quick-calc'

export default function QuickCalcDock() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    function onOpenEvent() {
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener(QUICK_CALC_EVENT, onOpenEvent)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(QUICK_CALC_EVENT, onOpenEvent)
    }
  }, [])

  return (
    <div
      className={`fixed inset-0 z-[70] ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-black/20 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={() => setOpen(false)}
      />
      <div
        className={`absolute right-0 top-0 flex h-full w-full flex-col border-l border-border bg-background shadow-xl transition-transform sm:w-[460px] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Calculator className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Quick calc</h2>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/calc"
              onClick={() => setOpen(false)}
              className="relative rounded p-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="Open the full page, where a calculation can be linked and saved"
            >
              <ExternalLink className="size-4" />
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="relative rounded p-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {/* No URL sync and no save here: the dock does not own the address
              bar, and saving onto a deal is a decision that deserves the page. */}
          <QuickCalc initial={EMPTY_SCRATCH} showSave={false} syncUrl={false} />
          <p className="mt-4 text-[11px] text-muted-foreground">
            Open the full page to copy a link to these figures or add them to a deal.
          </p>
        </div>
      </div>
    </div>
  )
}
