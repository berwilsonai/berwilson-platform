'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Building2,
  ClipboardCheck,
  Activity,
  Brain,
  Mail,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Shield,
  TrendingUp,
  Globe,
  AlertTriangle,
  Sparkles,
  FileUp,
} from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/attention', label: 'Attention', icon: AlertTriangle },
  { href: '/proposals/intake', label: 'Intake Proposal', icon: FileUp },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/briefs', label: 'Briefs', icon: Sparkles },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/vendors', label: 'Vendors', icon: Building2 },
  { href: '/company', label: 'Ber Wilson', icon: Shield },
  { href: '/review', label: 'Review Queue', icon: ClipboardCheck },
  { href: '/email-log', label: 'Email Log', icon: Mail },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/intel', label: 'Intel', icon: Brain },
] as const

interface AppSidebarProps {
  pendingReviewCount?: number
  attentionCount?: number
}

export default function AppSidebar({ pendingReviewCount = 0, attentionCount = 0 }: AppSidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={`hidden md:flex flex-col bg-sidebar shrink-0 transition-[width] duration-200 ease-in-out ${
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
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          const isReview = href === '/review'
          const isAttention = href === '/attention'
          const badgeCount = isReview ? pendingReviewCount : isAttention ? attentionCount : 0
          const showBadge = badgeCount > 0
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? (showBadge ? `${label} (${badgeCount})` : label) : undefined}
              className={`flex items-center gap-3 px-2.5 py-2.5 rounded text-sm font-medium transition-colors ${
                active
                  ? 'bg-sidebar-accent text-sidebar-foreground'
                  : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent'
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

        {/* Portfolio */}
        <div className="mt-2 pt-2 border-t border-sidebar-border">
          <Link
            href="/portfolio"
            title={collapsed ? 'Portfolio' : undefined}
            className={`flex items-center gap-3 px-2.5 py-2.5 rounded text-sm font-medium transition-colors ${
              pathname === '/portfolio' || pathname.startsWith('/portfolio/')
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent'
            }`}
          >
            <Globe size={15} className="shrink-0" />
            {!collapsed && <span className="truncate">Portfolio</span>}
          </Link>
        </div>

        {/* Equity & Valuation */}
        <div className="mt-2 pt-2 border-t border-sidebar-border">
          <Link
            href="/equity"
            title={collapsed ? 'Equity & Valuation' : undefined}
            className={`flex items-center gap-3 px-2.5 py-2.5 rounded text-sm font-medium transition-colors ${
              pathname === '/equity' || pathname.startsWith('/equity/')
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent'
            }`}
          >
            <TrendingUp size={15} className="shrink-0" />
            {!collapsed && <span className="truncate">Equity & Valuation</span>}
          </Link>
        </div>
      </nav>
    </aside>
  )
}
