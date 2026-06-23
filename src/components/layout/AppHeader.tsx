'use client'

import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { LogOut, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import ThemeToggle from './ThemeToggle'
import CommandPalette from './CommandPalette'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/attention': 'Attention',
  '/projects': 'Projects',
  '/calendar': 'Calendar',
  '/contacts': 'Contacts',
  '/vendors': 'Vendors & Contractors',
  '/company': 'Ber Wilson',
  '/review': 'Review Queue',
  '/email-log': 'Email Log',
  '/activity': 'Activity',
  '/intel': 'Intel',
  '/portfolio': 'Portfolio',
  '/equity': 'Equity & Valuation',
  '/proposals/intake': 'Intake Proposal',
}

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (pathname.startsWith(path + '/')) return title
  }
  return 'Ber Wilson'
}

function initials(email: string): string {
  const parts = email.split('@')[0].split(/[._-]/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return email.slice(0, 2).toUpperCase()
}

export default function AppHeader({ email }: { email: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Global ⌘K / Ctrl+K to open the command palette.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const closePalette = useCallback(() => setPaletteOpen(false), [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      <header className="h-14 flex items-center justify-between px-4 sm:px-6 border-b border-border bg-background/80 backdrop-blur-sm shrink-0 sticky top-0 z-10">
        {/* Logo + page title */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Image
            src="/logo.png"
            alt="Ber Wilson"
            width={100}
            height={54}
            className="object-contain h-5 w-auto md:hidden shrink-0"
            priority
          />
          <h1 className="text-base font-semibold text-foreground truncate heading-tight">{getPageTitle(pathname)}</h1>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Desktop search trigger — looks like a search box, opens the palette */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden md:flex items-center gap-2 h-8 pl-2.5 pr-2 rounded-lg border border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Search"
          >
            <Search size={14} />
            <span className="text-xs">Search…</span>
            <kbd className="ml-2 inline-flex items-center rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium">
              ⌘K
            </kbd>
          </button>

          {/* Mobile search button */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors md:hidden"
            aria-label="Search"
          >
            <Search size={16} />
          </button>

          <ThemeToggle />

          <div className="flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-muted/50 transition-colors">
            <div className="size-7 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center shrink-0">
              {initials(email)}
            </div>
            <span className="text-xs text-muted-foreground hidden md:block max-w-[160px] truncate">
              {email}
            </span>
          </div>

          <button
            onClick={handleSignOut}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {paletteOpen && <CommandPalette onClose={closePalette} />}
    </>
  )
}
