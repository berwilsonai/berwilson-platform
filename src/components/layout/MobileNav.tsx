'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  CalendarDays,
  ClipboardCheck,
  Brain,
  MoreHorizontal,
  Users,
  Building2,
  Shield,
  Activity,
  TrendingUp,
  Globe,
  AlertTriangle,
  FileUp,
  ListTodo,
  GanttChart,
  Gauge,
  Lightbulb,
  X,
} from 'lucide-react'

const PRIMARY_NAV = [
  { href: '/tasks', label: 'Tasks', icon: ListTodo },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/intel', label: 'Intel', icon: Brain },
  { href: '/review', label: 'Review', icon: ClipboardCheck, hasBadge: true },
] as const

const MORE_NAV = [
  { href: '/opportunities', label: 'Opportunities', icon: Lightbulb },
  { href: '/attention', label: 'Attention', icon: AlertTriangle },
  { href: '/proposals/intake', label: 'Ingest', icon: FileUp },
  { href: '/timeline', label: 'Timeline', icon: GanttChart },
  { href: '/capacity', label: 'Capacity', icon: Gauge },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/portfolio', label: 'Portfolio', icon: Globe },
  { href: '/equity', label: 'Equity', icon: TrendingUp },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/vendors', label: 'Vendors & Contractors', icon: Building2 },
  { href: '/company', label: 'Ber Wilson', icon: Shield },
  { href: '/activity', label: 'Activity', icon: Activity },
] as const

interface MobileNavProps {
  pendingCount?: number
}

export default function MobileNav({ pendingCount = 0 }: MobileNavProps) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  const moreActive = MORE_NAV.some(
    ({ href }) => pathname === href || pathname.startsWith(href + '/')
  )

  return (
    <>
      {/* More drawer overlay */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* More drawer */}
      <div
        className={`md:hidden fixed inset-x-0 z-50 bg-sidebar border-t border-sidebar-border transition-transform duration-200 ease-in-out ${
          moreOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
          <span className="text-xs font-semibold text-sidebar-foreground/60 uppercase tracking-wider">
            More
          </span>
          <button
            onClick={() => setMoreOpen(false)}
            className="p-1 rounded text-sidebar-foreground/50 hover:text-sidebar-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-px bg-sidebar-border">
          {/* Upload document — opens the quick-upload sheet (replaces the old floating button) */}
          <button
            onClick={() => {
              setMoreOpen(false)
              window.dispatchEvent(new Event('open-quick-upload'))
            }}
            className="flex flex-col items-center gap-1.5 py-4 text-xs font-medium transition-colors bg-sidebar text-sidebar-foreground/60 hover:text-sidebar-foreground"
          >
            <FileUp size={22} className="text-sidebar-foreground/50" />
            Upload
          </button>
          {MORE_NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMoreOpen(false)}
                className={`flex flex-col items-center gap-1.5 py-4 text-xs font-medium transition-colors bg-sidebar ${
                  active ? 'text-sidebar-foreground' : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
                }`}
              >
                <Icon size={22} className={active ? 'text-sidebar-foreground' : 'text-sidebar-foreground/50'} />
                {label}
              </Link>
            )
          })}
        </div>
      </div>

      {/* Bottom tab bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-sidebar border-t border-sidebar-border"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex">
          {PRIMARY_NAV.map(({ href, label, icon: Icon, ...rest }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            const showBadge = 'hasBadge' in rest && rest.hasBadge && pendingCount > 0
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                  active
                    ? 'text-sidebar-foreground bg-sidebar-accent'
                    : 'text-sidebar-foreground/50 hover:text-sidebar-foreground/70'
                }`}
              >
                <span className="relative">
                  <Icon
                    size={20}
                    className={active ? 'text-sidebar-foreground' : 'text-sidebar-foreground/50'}
                  />
                  {showBadge && (
                    <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-sidebar leading-none">
                      {pendingCount > 99 ? '99+' : pendingCount}
                    </span>
                  )}
                </span>
                {label}
              </Link>
            )
          })}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
              moreOpen || moreActive
                ? 'text-sidebar-foreground bg-sidebar-accent'
                : 'text-sidebar-foreground/50 hover:text-sidebar-foreground/70'
            }`}
          >
            <MoreHorizontal
              size={20}
              className={moreOpen || moreActive ? 'text-sidebar-foreground' : 'text-sidebar-foreground/50'}
            />
            More
          </button>
        </div>
      </nav>
    </>
  )
}
