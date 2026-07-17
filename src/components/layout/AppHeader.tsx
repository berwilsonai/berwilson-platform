'use client'

import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { Search, Sparkles } from 'lucide-react'
import UserMenu from './UserMenu'
import CommandPalette from './CommandPalette'
import type { Role } from '@/lib/auth/permissions'
import { pageTitle } from '@/lib/nav'

export default function AppHeader({ email, role = 'admin' }: { email: string; role?: Role }) {
  const pathname = usePathname()
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Cross-portfolio surfaces (search + Ask Ber AI) are admin-only.
  const isAdmin = role === 'admin'

  // Global ⌘K / Ctrl+K to open the command palette.
  useEffect(() => {
    if (!isAdmin) return
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isAdmin])

  const closePalette = useCallback(() => setPaletteOpen(false), [])

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
          <h1 className="text-base font-semibold text-foreground truncate heading-tight">{pageTitle(pathname)}</h1>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isAdmin && (
          <>
          {/* Ask Ber AI — ambient agent, available everywhere */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('open-ber-ai'))}
            className="hidden md:flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
            aria-label="Ask Ber AI"
          >
            <Sparkles size={14} />
            <span className="text-xs font-medium">Ask Ber AI</span>
            <kbd className="ml-1 inline-flex items-center rounded border border-primary/20 bg-background px-1.5 py-0.5 text-[10px] font-medium">
              ⌘J
            </kbd>
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('open-ber-ai'))}
            className="p-2 rounded-md text-primary hover:bg-primary/10 transition-colors md:hidden"
            aria-label="Ask Ber AI"
          >
            <Sparkles size={16} />
          </button>

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
          </>
          )}

          {/* Google Drive shortcut — plain external link, opens in a new tab */}
          <a
            href="https://drive.google.com/drive/folders/0AA94zfjPBG5dUk9PVA"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Open Ber Wilson Google Drive"
            title="Google Drive"
          >
            <svg viewBox="0 0 87.3 78" className="h-4 w-4" aria-hidden="true">
              <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
              <path fill="#00ac47" d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" />
              <path fill="#ea4335" d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
              <path fill="#00832d" d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
              <path fill="#2684fc" d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
              <path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
            </svg>
          </a>

          <UserMenu email={email} />
        </div>
      </header>

      {isAdmin && paletteOpen && <CommandPalette onClose={closePalette} />}
    </>
  )
}
