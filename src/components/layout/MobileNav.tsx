'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { MoreHorizontal, FileUp, X } from 'lucide-react'
import { canAccessPage, type Role } from '@/lib/auth/permissions'
import { NAV_ITEMS, navItemActive, resolveNavItem } from '@/lib/nav'

interface MobileNavProps {
  pendingCount?: number
  role?: Role
}

export default function MobileNav({ pendingCount = 0, role = 'admin' }: MobileNavProps) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const isAdmin = role === 'admin'

  const accessible = NAV_ITEMS.map((item) => resolveNavItem(item, (href) => canAccessPage(role, href)))
    .filter((item): item is NonNullable<typeof item> => item !== null)
  const primaryNav = accessible.filter((item) => item.mobilePrimary)
  const moreNav = accessible.filter((item) => !item.mobilePrimary)

  const moreActive = moreNav.some((item) => navItemActive(item, pathname))

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
          <span className="label-caps text-sidebar-foreground/75">
            More
          </span>
          <button
            onClick={() => setMoreOpen(false)}
            className="p-1 rounded text-sidebar-foreground/70 hover:text-sidebar-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-px bg-sidebar-border">
          {/* Upload document — opens the quick-upload sheet (replaces the old floating button) */}
          {isAdmin && (
            <button
              onClick={() => {
                setMoreOpen(false)
                window.dispatchEvent(new Event('open-quick-upload'))
              }}
              className="flex flex-col items-center gap-1.5 py-4 text-xs font-medium transition-colors bg-sidebar text-sidebar-foreground/75 hover:text-sidebar-foreground"
            >
              <FileUp size={22} className="text-sidebar-foreground/70" />
              Upload
            </button>
          )}
          {moreNav.map((item) => {
            const { href, label, icon: Icon } = item
            const active = navItemActive(item, pathname)
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMoreOpen(false)}
                className={`flex flex-col items-center gap-1.5 py-4 text-xs font-medium transition-colors bg-sidebar ${
                  active ? 'text-sidebar-foreground' : 'text-sidebar-foreground/75 hover:text-sidebar-foreground'
                }`}
              >
                <Icon size={22} className={active ? 'text-sidebar-foreground' : 'text-sidebar-foreground/70'} />
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
          {primaryNav.map((item) => {
            const { href, icon: Icon, badge } = item
            // The tab bar uses short labels; "Review Queue" reads as "Review".
            const label = href === '/review' ? 'Review' : item.label
            const active = navItemActive(item, pathname)
            const showBadge = badge === 'review' && pendingCount > 0
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                  active
                    ? 'text-sidebar-foreground bg-sidebar-accent'
                    : 'text-sidebar-foreground/70 hover:text-sidebar-foreground'
                }`}
              >
                <span className="relative">
                  <Icon
                    size={20}
                    className={active ? 'text-sidebar-foreground' : 'text-sidebar-foreground/70'}
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

          {/* More button — hidden when the drawer would be empty */}
          {(moreNav.length > 0 || isAdmin) && (
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
              moreOpen || moreActive
                ? 'text-sidebar-foreground bg-sidebar-accent'
                : 'text-sidebar-foreground/70 hover:text-sidebar-foreground/70'
            }`}
          >
            <MoreHorizontal
              size={20}
              className={moreOpen || moreActive ? 'text-sidebar-foreground' : 'text-sidebar-foreground/70'}
            />
            More
          </button>
          )}
        </div>
      </nav>
    </>
  )
}
