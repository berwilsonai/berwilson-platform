'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Players', segment: 'players' },
  { label: 'Updates', segment: 'updates' },
  { label: 'Tasks', segment: 'tasks' },
  { label: 'Documents', segment: 'documents' },
  { label: 'Milestones', segment: 'milestones' },
  { label: 'Financing', segment: 'financing' },
  { label: 'Diligence', segment: 'diligence' },
  { label: 'Entities', segment: 'entities' },
]

interface ProjectTabBarProps {
  projectId: string
}

export default function ProjectTabBar({ projectId }: ProjectTabBarProps) {
  const pathname = usePathname()
  const base = `/projects/${projectId}`

  return (
    <div className="border-b border-border overflow-x-auto scrollbar-none">
      <nav className="flex min-w-max -mb-px">
        {TABS.map(({ label, segment }) => {
          const href = segment ? `${base}/${segment}` : base
          const isActive = segment
            ? pathname === href || pathname.startsWith(`${href}/`)
            : pathname === base
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                isActive
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
