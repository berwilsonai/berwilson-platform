'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * `always` tabs are shown whatever the project holds.
 *
 * Overview is derived from the project row itself, and Updates and Documents
 * are where the work actually lands — measured across all 15 projects, they
 * were the only two with rows on more than one. Everything else appears when
 * that project has something in it, and otherwise waits under More.
 */
const TABS: { label: string; segment: string; key?: TabKey; always?: true }[] = [
  { label: 'Overview', segment: '', always: true },
  { label: 'Updates', segment: 'updates', key: 'updates', always: true },
  { label: 'Documents', segment: 'documents', key: 'documents', always: true },
  { label: 'Players', segment: 'players', key: 'players' },
  { label: 'Meetings', segment: 'meetings', key: 'meetings' },
  { label: 'Tasks', segment: 'tasks', key: 'tasks' },
  { label: 'Milestones', segment: 'milestones', key: 'milestones' },
  { label: 'Financing', segment: 'financing', key: 'financing' },
  { label: 'Diligence', segment: 'diligence', key: 'diligence' },
  { label: 'Entities & Vendors', segment: 'entities', key: 'entities' },
]

export type TabKey =
  | 'players' | 'updates' | 'meetings' | 'tasks' | 'documents'
  | 'milestones' | 'financing' | 'diligence' | 'entities'

interface ProjectTabBarProps {
  projectId: string
  counts: Record<TabKey, number>
}

export default function ProjectTabBar({ projectId, counts }: ProjectTabBarProps) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const base = `/projects/${projectId}`

  const hrefFor = (segment: string) => (segment ? `${base}/${segment}` : base)
  const isActiveTab = (segment: string) =>
    segment ? pathname === hrefFor(segment) || pathname.startsWith(`${hrefFor(segment)}/`) : pathname === base

  // An empty tab you are standing on must stay in the bar — otherwise it
  // disappears from under you the moment you navigate to it.
  const visible = TABS.filter((t) => t.always || (t.key && counts[t.key] > 0) || isActiveTab(t.segment))
  const hidden = TABS.filter((t) => !visible.includes(t))

  return (
    <div className="border-b border-border flex items-stretch">
      <nav className="flex min-w-max -mb-px overflow-x-auto scrollbar-none">
        {visible.map(({ label, segment, key }) => {
          const href = hrefFor(segment)
          const n = key ? counts[key] : 0
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
