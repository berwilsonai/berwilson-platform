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
  Mail,
  Activity,
  TrendingUp,
  X,
} from 'lucide-react'

const PRIMARY_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/intel', label: 'Intel', icon: Brain },
  { href: '/review', label: 'Review', icon: ClipboardCheck, hasBadge: true },
] as const

const MORE_NAV = [
  { href: '/equity', label: 'Equity', icon: TrendingUp },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/vendors', label: 'Vendors', icon: Building2 },
  { href: '/company', label: 'Ber Wilson', icon: Shield },
  { href: '/email-log', label: 'Email Log', icon: Mail },
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
        className={`md:hidden fixed inset-x-0 z-50 bg-slate-900 border-t border-slate-700 transition-transform duration-200 ease-in-out ${
          moreOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            More
          </span>
          <button
            onClick={() => setMoreOpen(false)}
            className="p-1 rounded text-slate-500 hover:text-white"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-px bg-slate-800">
          {MORE_NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMoreOpen(false)}
                className={`flex flex-col items-center gap-1.5 py-4 text-[11px] font-medium transition-colors bg-slate-900 ${
                  active ? 'text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon size={22} className={active ? 'text-white' : 'text-slate-500'} />
                {label}
              </Link>
            )
          })}
        </div>
      </div>

      {/* Bottom tab bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-slate-900 border-t border-slate-800"
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
                className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${
                  active
                    ? 'text-white bg-slate-800'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <span className="relative">
                  <Icon
                    size={20}
                    className={active ? 'text-white' : 'text-slate-500'}
                  />
                  {showBadge && (
                    <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-slate-900 leading-none">
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
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${
              moreOpen || moreActive
                ? 'text-white bg-slate-800'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <MoreHorizontal
              size={20}
              className={moreOpen || moreActive ? 'text-white' : 'text-slate-500'}
            />
            More
          </button>
        </div>
      </nav>
    </>
  )
}
