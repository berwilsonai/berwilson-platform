'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'

const TABS = [
  { label: 'Overview', tab: 'overview' },
  { label: 'Projects', tab: 'projects' },
  { label: 'Activity', tab: 'activity' },
  { label: 'Notes', tab: 'notes' },
]

interface ContactTabBarProps {
  contactId: string
  activeTab: string
}

export default function ContactTabBar({ contactId, activeTab }: ContactTabBarProps) {
  return (
    <div className="border-b border-border overflow-x-auto scrollbar-none">
      <nav className="flex min-w-max -mb-px">
        {TABS.map(({ label, tab }) => {
          const isActive = activeTab === tab
          const href = `/contacts/${contactId}?tab=${tab}`
          return (
            <Link
              key={tab}
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
