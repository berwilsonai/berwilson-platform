'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  ListChecks,
  ClipboardCheck,
  Activity,
  Brain,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Shield,
  FileUp,
  Lightbulb,
  Inbox,
  Target,
  UserCog,
  HeartPulse,
  Map as MapIcon,
  HandCoins,
} from 'lucide-react'
import { canAccessPage, type Role } from '@/lib/auth/permissions'

const NAV_GROUPS = [
  {
    label: null, // No label for primary group
    items: [
      { href: '/tasks', label: 'Tasks', icon: ListChecks },
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/objectives', label: 'Objectives', icon: Target },
      { href: '/projects', label: 'Projects', icon: FolderKanban },
      { href: '/opportunities', label: 'Opportunities', icon: Lightbulb },
      { href: '/investors', label: 'Investors', icon: HandCoins },
      { href: '/map', label: 'Map', icon: MapIcon },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { href: '/intel', label: 'Intel', icon: Brain },
      { href: '/proposals/intake', label: 'Proposal Intake', icon: FileUp },
      { href: '/email-ingestion', label: 'Email Intake', icon: Inbox },
      { href: '/calendar', label: 'Calendar', icon: CalendarDays },
    ],
  },
  {
    label: 'Directory',
    items: [
      { href: '/contacts', label: 'Contacts & Vendors', icon: Users },
      { href: '/company', label: 'Ber Wilson', icon: Shield },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/review', label: 'Review Queue', icon: ClipboardCheck },
      { href: '/activity', label: 'Activity', icon: Activity },
      { href: '/settings/users', label: 'Users & Access', icon: UserCog },
      { href: '/settings/health', label: 'System Health', icon: HeartPulse },
    ],
  },
] as const

interface AppSidebarProps {
  pendingReviewCount?: number
  attentionCount?: number
  role?: Role
}

export default function AppSidebar({ pendingReviewCount = 0, attentionCount = 0, role = 'admin' }: AppSidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  // Only show sections this role can actually visit; drop emptied groups.
  const navGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(({ href }) => canAccessPage(role, href)),
  })).filter((group) => group.items.length > 0)

  return (
    <aside
      className={`hidden md:flex flex-col sidebar-gradient shrink-0 transition-[width] duration-200 ease-in-out ${
        collapsed ? 'w-14' : 'w-56'
      }`}
    >
      {/* Brand */}
      <div
        className={`flex items-center h-14 px-3 border-b border-sidebar-border ${
          collapsed ? 'justify-center' : 'justify-between'
        }`}
      >
        {!collapsed ? (
          <Image src="/logo.png" alt="Ber Wilson" width={120} height={65} className="object-contain h-8 w-auto" priority />
        ) : (
          <Image src="/logo.png" alt="Ber Wilson" width={28} height={28} className="object-contain h-6 w-auto" priority />
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto">
        {navGroups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-4 pt-3 border-t border-sidebar-border' : ''}>
            {group.label && !collapsed && (
              <p className="px-2.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/55">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active =
                  pathname === href ||
                  pathname.startsWith(href + '/') ||
                  // vendor detail/new pages belong to the Directory item
                  (href === '/contacts' && pathname.startsWith('/vendors'))
                const isReview = href === '/review'
                const isAttention = href === '/dashboard' // attention folded into the dashboard
                const badgeCount = isReview ? pendingReviewCount : isAttention ? attentionCount : 0
                const showBadge = badgeCount > 0
                return (
                  <Link
                    key={href}
                    href={href}
                    title={collapsed ? (showBadge ? `${label} (${badgeCount})` : label) : undefined}
                    className={`flex items-center gap-3 px-2.5 py-2 rounded text-sm font-medium transition-colors ${
                      active
                        ? 'sidebar-nav-active text-sidebar-foreground'
                        : 'text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent'
                    }`}
                  >
                    <span className="relative shrink-0">
                      <Icon size={16} />
                      {showBadge && collapsed && (
                        <span className="absolute -top-1 -right-1 size-2 rounded-full bg-amber-400" />
                      )}
                    </span>
                    {!collapsed && (
                      <>
                        <span className="truncate flex-1">{label}</span>
                        {showBadge && (
                          <span className={`ml-auto text-xs font-mono font-semibold px-1.5 py-0.5 rounded-full leading-none ${
                            isAttention ? 'bg-red-500 text-white' : 'bg-amber-400 text-sidebar'
                          }`}>
                            {badgeCount > 99 ? '99+' : badgeCount}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
