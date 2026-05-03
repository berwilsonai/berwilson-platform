'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  ClipboardCheck,
  Brain,
} from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/review', label: 'Review', icon: ClipboardCheck, hasBadge: true },
  { href: '/intel', label: 'Intel', icon: Brain },
] as const

interface MobileNavProps {
  pendingCount?: number
}

export default function MobileNav({ pendingCount = 0 }: MobileNavProps) {
  const pathname = usePathname()

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-slate-900 border-t border-slate-800"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex">
        {NAV_ITEMS.map(({ href, label, icon: Icon, ...rest }) => {
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
      </div>
    </nav>
  )
}
