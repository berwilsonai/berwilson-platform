'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  ClipboardCheck,
  Activity,
  Brain,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/review', label: 'Review Queue', icon: ClipboardCheck },
  { href: '/activity', label: 'Activity', icon: Activity },
] as const

const DISABLED_ITEMS = [
  { href: '/intel', label: 'Intel', icon: Brain, badge: 'Phase 3' },
] as const

interface AppSidebarProps {
  pendingReviewCount?: number
}

export default function AppSidebar({ pendingReviewCount = 0 }: AppSidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={`hidden md:flex flex-col bg-slate-900 shrink-0 transition-[width] duration-200 ease-in-out ${
        collapsed ? 'w-14' : 'w-56'
      }`}
    >
      {/* Brand */}
      <div
        className={`flex items-center h-14 px-3 border-b border-slate-800 ${
          collapsed ? 'justify-center' : 'justify-between'
        }`}
      >
        {!collapsed && (
          <span className="text-white font-semibold text-xs tracking-widest uppercase truncate">
            Ber Wilson
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          const isReview = href === '/review'
          const showBadge = isReview && pendingReviewCount > 0
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? (showBadge ? `${label} (${pendingReviewCount})` : label) : undefined}
              className={`flex items-center gap-3 px-2.5 py-2 rounded text-sm font-medium transition-colors ${
                active
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <span className="relative shrink-0">
                <Icon size={15} />
                {showBadge && collapsed && (
                  <span className="absolute -top-1 -right-1 size-2 rounded-full bg-amber-400" />
                )}
              </span>
              {!collapsed && (
                <>
                  <span className="truncate flex-1">{label}</span>
                  {showBadge && (
                    <span className="ml-auto text-[10px] font-mono font-semibold bg-amber-400 text-slate-900 px-1.5 py-0.5 rounded-full leading-none">
                      {pendingReviewCount > 99 ? '99+' : pendingReviewCount}
                    </span>
                  )}
                </>
              )}
            </Link>
          )
        })}

        <div className="py-2 px-2.5">
          <div className="h-px bg-slate-800" />
        </div>

        {/* Disabled items */}
        {DISABLED_ITEMS.map(({ label, icon: Icon, badge }) => (
          <div
            key={label}
            title={collapsed ? `${label} — ${badge}` : badge}
            className="flex items-center gap-3 px-2.5 py-2 rounded text-sm font-medium text-slate-600 cursor-not-allowed select-none"
          >
            <Icon size={15} className="shrink-0" />
            {!collapsed && (
              <>
                <span className="truncate flex-1">{label}</span>
                <span className="text-[10px] font-mono bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">
                  {badge}
                </span>
              </>
            )}
          </div>
        ))}
      </nav>
    </aside>
  )
}
