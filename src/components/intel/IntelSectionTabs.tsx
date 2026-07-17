import Link from 'next/link'
import { Brain, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The Intelligence section's destinations — Intel (agent) and Calendar live
 * under one nav entry; this tab row connects them on both pages.
 */
export default function IntelSectionTabs({ active }: { active: 'intel' | 'calendar' }) {
  const tabs = [
    { key: 'intel' as const, href: '/intel', label: 'Ask Ber AI', icon: Brain },
    { key: 'calendar' as const, href: '/calendar', label: 'Calendar', icon: CalendarDays },
  ]
  return (
    <div className="flex items-center gap-1 border-b border-border">
      {tabs.map(({ key, href, label, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 text-sm font-medium transition-colors',
            active === key
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Icon size={14} />
          {label}
        </Link>
      ))}
    </div>
  )
}
