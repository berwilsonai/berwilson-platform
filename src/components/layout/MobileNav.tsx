'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  ClipboardCheck,
  Activity,
} from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/review', label: 'Review', icon: ClipboardCheck },
  { href: '/activity', label: 'Activity', icon: Activity },
] as const

export default function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-slate-900 border-t border-slate-800">
      <div className="flex">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${
                active ? 'text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Icon
                size={18}
                className={active ? 'text-white' : 'text-slate-500'}
              />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
