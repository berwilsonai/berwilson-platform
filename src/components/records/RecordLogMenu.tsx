'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { logEntries, logHref, type RecordKind } from '@/lib/records/log-menu'

/**
 * ONE OBVIOUS PLACE TO LOG SOMETHING BY HAND.
 *
 * Every manual door already existed — the Meetings tab has a full form that
 * takes a pasted transcript and drafts a summary from it, Updates takes a
 * typed note or a pasted email, the task board has New task — and none of them
 * was findable, because `RecordTabBar` hides a tab with no rows under More.
 * That rule is right for READING a populated record and exactly wrong for the
 * first WRITE: measured 2026-10-18 on live data, 17 of 19 projects had no
 * meeting at all, so on 17 of 19 projects the only door to logging one was
 * two clicks down a menu labelled "More".
 *
 * So creation lives here, in the record header, on every tab, whatever the
 * record holds; the count-gating stays for reading. What the menu offers and
 * where each entry lands is `src/lib/records/log-menu.ts` — including which
 * destinations honour `?new=1`, so the menu is never a promise the page fails
 * to keep.
 */

interface Props {
  basePath: string
  kind: RecordKind
  /** Non-admins read; only an admin creates meetings (mirrors MeetingsView). */
  canLogMeeting?: boolean
}

export default function RecordLogMenu({ basePath, kind, canLogMeeting = true }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const entries = logEntries(kind, canLogMeeting)

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 active:scale-[0.98] transition-all elev-1"
      >
        <Plus size={13} />
        Log
        <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-lg border border-border bg-popover text-popover-foreground elev-3 p-1 animate-fade-in-up"
        >
          <p className="px-3 pt-2 pb-1.5 label-caps text-muted-foreground">
            Log on this {kind}
          </p>
          {entries.map((entry) => {
            const Icon = entry.icon
            const href = logHref(basePath, entry)
            return (
              <Link
                key={entry.segment}
                role="menuitem"
                href={href}
                onClick={() => setOpen(false)}
                className="flex items-start gap-2.5 px-3 py-2 rounded-md hover:bg-muted transition-colors"
              >
                <Icon size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{entry.label}</span>
                  <span className="block text-xs text-muted-foreground">{entry.hint}</span>
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
