'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react'
import { canAccessPage, type Role } from '@/lib/auth/permissions'
import { NAV_ITEMS, NAV_GROUP_ORDER, navItemActive } from '@/lib/nav'

interface AppSidebarProps {
  pendingReviewCount?: number
  attentionCount?: number
  role?: Role
}

export default function AppSidebar({ pendingReviewCount = 0, attentionCount = 0, role = 'admin' }: AppSidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [systemOpen, setSystemOpen] = useState(false)

  // Only show sections this role can actually visit; drop emptied groups.
  // The System group lives behind the gear at the bottom, not in the main list.
  const navGroups = NAV_GROUP_ORDER.filter(({ group }) => group !== 'system')
    .map(({ group, label }) => ({
      label,
      items: NAV_ITEMS.filter((item) => item.group === group && canAccessPage(role, item.href)),
    }))
    .filter((group) => group.items.length > 0)

  const systemItems = NAV_ITEMS.filter(
    (item) => item.group === 'system' && canAccessPage(role, item.href)
  )
  const systemActive = systemItems.some((item) => navItemActive(item, pathname))

  const badgeCounts = { review: pendingReviewCount, attention: attentionCount }

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
              <p className="px-2.5 mb-1.5 label-caps text-sidebar-foreground/55">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const { href, label, icon: Icon, badge } = item
                const active = navItemActive(item, pathname)
                const badgeCount = badge ? badgeCounts[badge] : 0
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
                            badge === 'attention' ? 'bg-destructive text-white' : 'bg-amber-400 text-sidebar'
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

      {/* System — tucked behind the gear; expands in place when needed */}
      {systemItems.length > 0 && (
        <div className="px-2 py-2 border-t border-sidebar-border">
          {(systemOpen || systemActive) && (
            <div className="space-y-0.5 mb-1">
              {systemItems.map((item) => {
                const { href, label, icon: Icon, badge } = item
                const active = navItemActive(item, pathname)
                const badgeCount = badge ? badgeCounts[badge] : 0
                return (
                  <Link
                    key={href}
                    href={href}
                    title={collapsed ? label : undefined}
                    className={`flex items-center gap-3 px-2.5 py-2 rounded text-sm font-medium transition-colors ${
                      active
                        ? 'sidebar-nav-active text-sidebar-foreground'
                        : 'text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent'
                    }`}
                  >
                    <Icon size={16} className="shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="truncate flex-1">{label}</span>
                        {badgeCount > 0 && (
                          <span className="ml-auto text-xs font-mono font-semibold px-1.5 py-0.5 rounded-full leading-none bg-amber-400 text-sidebar">
                            {badgeCount > 99 ? '99+' : badgeCount}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
          <button
            onClick={() => setSystemOpen((o) => !o)}
            title={collapsed ? 'System' : undefined}
            className={`w-full flex items-center gap-3 px-2.5 py-2 rounded text-sm font-medium transition-colors ${
              systemOpen || systemActive
                ? 'text-sidebar-foreground'
                : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent'
            }`}
            aria-expanded={systemOpen}
          >
            <span className="relative shrink-0">
              <Settings size={16} />
              {pendingReviewCount > 0 && !systemOpen && !systemActive && (
                <span className="absolute -top-1 -right-1 size-2 rounded-full bg-amber-400" />
              )}
            </span>
            {!collapsed && <span className="truncate flex-1 text-left">System</span>}
          </button>
        </div>
      )}
    </aside>
  )
}
