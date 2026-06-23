'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Components', segment: 'components' },
  { label: 'Capital Stack', segment: 'capital' },
  { label: 'Stakeholders', segment: 'stakeholders' },
  { label: 'Compliance', segment: 'compliance' },
  { label: 'Documents', segment: 'documents' },
]

export default function SiteTabBar({ siteId }: { siteId: string }) {
  const pathname = usePathname()
  const base = `/portfolio/sites/${siteId}`

  return (
    <div className="border-b border-slate-200 dark:border-border">
      <nav className="flex gap-0 -mb-px overflow-x-auto">
        {TABS.map(({ label, segment }) => {
          const href = segment ? `${base}/${segment}` : base
          const isActive = segment
            ? pathname === href || pathname.startsWith(href + '/')
            : pathname === base
          return (
            <Link
              key={segment || 'overview'}
              href={href}
              className={`shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-slate-900 dark:border-white/20 text-slate-900 dark:text-foreground'
                  : 'border-transparent text-slate-500 dark:text-muted-foreground hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-border'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
