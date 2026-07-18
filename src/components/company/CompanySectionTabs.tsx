import Link from 'next/link'
import { Building2, Network } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The company section's destinations — Profile (/company, admin-only) and
 * Structure (/company/structure, viewable by every role); this tab row
 * connects them on both pages. `showProfile` hides the Profile tab for
 * non-admin viewers, who would only get bounced to /tasks by the middleware.
 */
export default function CompanySectionTabs({
  active,
  showProfile,
}: {
  active: 'profile' | 'structure'
  showProfile: boolean
}) {
  const tabs = [
    ...(showProfile
      ? [{ key: 'profile' as const, href: '/company', label: 'Profile', icon: Building2 }]
      : []),
    { key: 'structure' as const, href: '/company/structure', label: 'Structure', icon: Network },
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
