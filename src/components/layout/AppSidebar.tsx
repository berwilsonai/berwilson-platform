'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { ChevronLeft, ChevronDown, Settings, Bug, Dot } from 'lucide-react'
import { canAccessPage, type Role } from '@/lib/auth/permissions'
import { NAV_ITEMS, NAV_GROUP_ORDER, navItemActive, resolveNavItem } from '@/lib/nav'
import { useStoredState } from '@/hooks/use-stored-state'
import type { LeadLane } from '@/lib/utils/leads'

interface AppSidebarProps {
  /** Module keys with no data — their nav rows are hidden. */
  emptyModules?: string[]
  pendingReviewCount?: number
  attentionCount?: number
  /** Open developer notes. Admin-only count; everyone gets the button. */
  openDevNoteCount?: number
  role?: Role
  /**
   * LEAD_LANE_NOTE — the trade divisions, nested under Leads.
   *
   * Read from `lead_categories` in the layout, never listed here: the whole
   * point of the routing registry is that adding a line of business is an
   * INSERT (§12), and a hardcoded trio in the sidebar would quietly make the
   * next trade invisible. Only `destination: 'handoff'` lanes appear —
   * construction, steel and corporate already have their own destinations in
   * this same menu, so repeating them here would be two routes to one place.
   */
  leadLanes?: LeadLane[]
}

export default function AppSidebar({ pendingReviewCount = 0, attentionCount = 0, openDevNoteCount = 0, role = 'admin', emptyModules = [], leadLanes = [] }: AppSidebarProps) {
  const pathname = usePathname()
  // The lead queue keeps its chosen division in `?route=`. Next 16 reflects a
  // `history.replaceState` into useSearchParams without a server round trip, so
  // clicking a division TAB on the page moves this highlight too — the sidebar
  // and the page can never disagree about where the reader is.
  const searchParams = useSearchParams()
  const [collapsed, setCollapsed] = useState(false)
  const [systemOpen, setSystemOpen] = useState(false)
  // Remembered per browser. A disclosure is exactly the per-viewer convenience
  // localStorage is for; nothing here needs to survive a cleared cache.
  const [lanesOpen, setLanesOpen] = useStoredState('sidebar-lead-lanes-open', true)

  const activeLane = pathname === '/leads' ? searchParams.get('route') : null

  // Only show sections this role can actually visit; drop emptied groups.
  // The System group lives behind the gear at the bottom, not in the main list.
  const navGroups = NAV_GROUP_ORDER.filter(({ group }) => group !== 'system')
    .map(({ group, label }) => ({
      label,
      items: NAV_ITEMS.filter(
        (item) => item.group === group && !(item.hideWhenEmpty && emptyModules.includes(item.hideWhenEmpty))
      )
        .map((item) => resolveNavItem(item, (href) => canAccessPage(role, href)))
        .filter((item): item is NonNullable<typeof item> => item !== null),
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
        {/* The rail is navy in both themes, so it always takes the cream
            wordmark.

            Collapsed, the chevron BECOMES the expand control rather than
            sitting next to one. The rail is 56px, 32px of it inside the
            padding, and the chevron is nearly twice as wide as it is tall —
            beside a 27px button it overflowed the rail by 21px. Folding the
            two together is also the better read: a chevron logo next to a
            chevron-right icon is two chevrons arguing in one 56px row. */}
        {!collapsed ? (
          <>
            <Image src="/logo-dark.png" alt="Ber Wilson" width={640} height={343} className="object-contain h-8 w-auto" priority />
            <button
              onClick={() => setCollapsed(true)}
              className="p-1.5 rounded text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft size={15} />
            </button>
          </>
        ) : (
          <button
            onClick={() => setCollapsed(false)}
            className="flex opacity-80 hover:opacity-100 transition-opacity"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <Image src="/logo-mark.png" alt="Ber Wilson" width={256} height={132} className="object-contain h-4 w-auto" priority />
          </button>
        )}
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
                // Leads carries the trade divisions beneath it. Everything else
                // renders as a plain row, exactly as before.
                const withLanes = href === '/leads' && !collapsed && leadLanes.length > 0
                const row = (
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
                            {badgeCount > 999 ? '999+' : badgeCount}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                )

                if (!withLanes) return row

                /*
                  The divisions, nested.
                  Open when the reader is standing in one, whatever the stored
                  preference says — the same rule the System group uses below.
                  Collapsing a section must never hide the row that is currently
                  highlighted, or the highlight is somewhere the reader cannot
                  see and the menu looks like it has lost its place.
                */
                const open = lanesOpen || !!activeLane
                return (
                  <div key={href}>
                    <div className="flex items-center gap-0.5">
                      <span className="flex-1 min-w-0">{row}</span>
                      <button
                        type="button"
                        onClick={() => setLanesOpen(!open)}
                        aria-expanded={open}
                        aria-label={open ? 'Hide divisions' : 'Show divisions'}
                        title={open ? 'Hide divisions' : 'Show divisions'}
                        className="shrink-0 rounded p-1.5 text-sidebar-foreground/45 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <ChevronDown
                          size={14}
                          className={`transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
                        />
                      </button>
                    </div>
                    {open && (
                      <div className="mt-0.5 space-y-0.5 border-l border-sidebar-border/70 ml-4 pl-1">
                        {leadLanes.map((lane) => {
                          const laneActive = activeLane === lane.key
                          return (
                            <Link
                              key={lane.key}
                              href={`/leads?route=${lane.key}`}
                              className={`flex items-center gap-1 rounded py-1.5 pl-1 pr-2.5 text-[13px] transition-colors ${
                                laneActive
                                  ? 'sidebar-nav-active text-sidebar-foreground'
                                  : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                              }`}
                            >
                              <Dot size={14} className="shrink-0 opacity-70" />
                              <span className="truncate">{lane.label}</span>
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/*
        Developer notes — bottom-left, above the System gear.
        Every role gets this, deliberately: the people most likely to hit a bug
        are the ones with the least access, and a feedback channel gated to
        admins has no reporters. The button OPENS A DIALOG rather than
        navigating, so the report carries the page the reporter was standing on
        (see DevNoteDock); the count below links through to the full list.
      */}
      <div className="px-2 pt-2 border-t border-sidebar-border">
        <button
          onClick={() => window.dispatchEvent(new Event('open-dev-note'))}
          title={collapsed ? 'Report a bug or request a feature' : undefined}
          className="w-full flex items-center gap-3 px-2.5 py-2 rounded text-sm font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <Bug size={16} className="shrink-0" />
          {!collapsed && <span className="truncate flex-1 text-left">Report an issue</span>}
        </button>
        {!collapsed && openDevNoteCount > 0 && (
          <Link
            href="/dev-notes"
            className={`block px-2.5 pb-1 text-xs transition-colors ${
              pathname.startsWith('/dev-notes')
                ? 'text-sidebar-foreground'
                : 'text-sidebar-foreground/45 hover:text-sidebar-foreground'
            }`}
          >
            {openDevNoteCount} open {openDevNoteCount === 1 ? 'report' : 'reports'}
          </Link>
        )}
      </div>

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
                            {badgeCount > 999 ? '999+' : badgeCount}
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
