import Link from 'next/link'
import { Building2, Network, Gavel, Users, Scale, ClipboardCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The company section's destinations.
 *
 * Structure (/company/structure) is viewable by every role; everything else is
 * admin-only. `showProfile` is true only for admins and therefore gates the
 * other five tabs too — without it a non-admin on the Structure page would see
 * links the middleware bounces them off, which is worse than not seeing them.
 *
 * ⚠ The gating is a PREFIX default-deny in permissions.ts, not a list of
 * exceptions: '/company/structure' is allowlisted for the other roles and prefix
 * matching means it does not grant '/company' or anything else under it. Adding
 * a tab here therefore adds an admin-only route by default, which is the right
 * way round for a section holding personnel files.
 */
export default function CompanySectionTabs({
  active,
  showProfile,
}: {
  active: 'profile' | 'structure' | 'board' | 'people' | 'governance' | 'compliance'
  showProfile: boolean
}) {
  const adminTabs = [
    { key: 'board' as const, href: '/company/board', label: 'Board', icon: Gavel },
    { key: 'governance' as const, href: '/company/governance', label: 'Corporate record', icon: Scale },
    { key: 'people' as const, href: '/company/people', label: 'Personnel', icon: Users },
    { key: 'compliance' as const, href: '/company/compliance', label: 'Compliance', icon: ClipboardCheck },
  ]

  const tabs = [
    ...(showProfile
      ? [{ key: 'profile' as const, href: '/company', label: 'Profile', icon: Building2 }]
      : []),
    { key: 'structure' as const, href: '/company/structure', label: 'Structure', icon: Network },
    ...(showProfile ? adminTabs : []),
  ]

  return (
    // Scrollable rather than wrapping: six tabs wrap to two lines on a phone and
    // the second line reads as a different control. `-mx-4 px-4` lets the row
    // bleed to the gutter so the last tab is reachable.
    <div className="-mx-4 overflow-x-auto border-b border-border px-4">
      <div className="flex min-w-max items-center gap-1">
        {tabs.map(({ key, href, label, icon: Icon }) => (
          <Link
            key={key}
            href={href}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 -mb-px text-sm font-medium transition-colors',
              'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
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
    </div>
  )
}
