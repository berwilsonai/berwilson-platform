'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The tab bar for a project or an opportunity. Both carry the same child
 * records — players, documents, milestones, diligence, financing, entities —
 * so they share one bar, differing only in the base path and in which tabs
 * the record always shows.
 *
 * `always` tabs are shown whatever the record holds. Overview is derived from
 * the record row itself, and the two where the work actually lands stay put:
 * measured across all 15 projects, Updates and Documents were the only tabs
 * with rows on more than one. Everything else appears when that record has
 * something in it, and otherwise waits under More — so a page never shows ten
 * tabs of which eight are empty.
 */
export type TabKey =
  | 'players' | 'updates' | 'meetings' | 'tasks' | 'documents'
  | 'milestones' | 'financing' | 'diligence' | 'entities'

export interface RecordTab {
  label: string
  segment: string
  key?: TabKey
  always?: true
}

interface RecordTabBarProps {
  basePath: string
  tabs: RecordTab[]
  counts: Partial<Record<TabKey, number>>
}

export default function RecordTabBar({ basePath: base, tabs, counts }: RecordTabBarProps) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  const hrefFor = (segment: string) => (segment ? `${base}/${segment}` : base)
  const isActiveTab = (segment: string) =>
    segment ? pathname === hrefFor(segment) || pathname.startsWith(`${hrefFor(segment)}/`) : pathname === base

  // An empty tab you are standing on must stay in the bar — otherwise it
  // disappears from under you the moment you navigate to it.
  const visible = tabs.filter((t) => t.always || (t.key && (counts[t.key] ?? 0) > 0) || isActiveTab(t.segment))
  const hidden = tabs.filter((t) => !visible.includes(t))

  return (
    <div className="border-b border-border flex items-stretch">
      <nav className="flex min-w-max -mb-px overflow-x-auto scrollbar-none">
        {visible.map(({ label, segment, key }) => {
          const href = hrefFor(segment)
          const n = key ? (counts[key] ?? 0) : 0
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                isActiveTab(segment)
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              {label}
              {n > 0 && <span className="ml-1.5 text-xs text-muted-foreground tnum">{n}</span>}
            </Link>
          )
        })}
      </nav>

      {hidden.length > 0 && (
        <div className="relative -mb-px">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            onBlur={() => setTimeout(() => setMoreOpen(false), 120)}
            aria-expanded={moreOpen}
            className="flex items-center gap-1 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            More
            <ChevronDown size={14} className={cn('transition-transform', moreOpen && 'rotate-180')} />
          </button>
          {moreOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 min-w-48 rounded-md border border-border bg-card elev-2 py-1">
              {hidden.map(({ label, segment }) => (
                <Link
                  key={segment}
                  href={hrefFor(segment)}
                  className="block px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
