'use client'

import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { Search, Sparkles } from 'lucide-react'
import UserMenu from './UserMenu'
import CommandPalette from './CommandPalette'
import type { Role } from '@/lib/auth/permissions'
import { pageTitle } from '@/lib/nav'
import { openDock } from '@/lib/ui/docks'
import { AGENT_UNREAD_EVENT, fetchUnreadAnswers } from '@/lib/ui/agent-unread'

export default function AppHeader({
  email,
  role = 'admin',
}: {
  email: string
  role?: Role
  /** Resolved server-side so the badge is correct on first paint. */
}) {
  const pathname = usePathname()
  const [paletteOpen, setPaletteOpen] = useState(false)

  /*
    How many answers are waiting.

    ⚠ POLLED, AND THAT IS THE POINT RATHER THAN A SHORTCUT. The answer this
    counts arrives in a process the browser cannot see — that is the whole
    feature — so there is nothing to push it here. A 30-second poll against a
    tailnet-only app on one machine costs nothing, and it is skipped entirely
    while the tab is hidden, because a background tab asking every half minute
    is the kind of thing that is invisible until it is somebody's battery.
  */
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    let alive = true
    const read = async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      const { unread: n } = await fetchUnreadAnswers()
      if (alive) setUnread(n)
    }
    void read()
    const timer = setInterval(read, 30_000)
    window.addEventListener(AGENT_UNREAD_EVENT, read)
    document.addEventListener('visibilitychange', read)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener(AGENT_UNREAD_EVENT, read)
      document.removeEventListener('visibilitychange', read)
    }
  }, [])
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
      {/*
        ⚠ A UTILITY BAR, NOT A MASTHEAD, AS OF 2026-10-27.

        This was 56px tall and set the page title at `text-lg font-semibold` —
        the same weight and nearly the same size as the `<h1>` that every page
        ALSO renders just below it. Two titles, stacked, saying the same word.
        The masthead moved into `PageHeader` (one idiom, where it belongs with
        the page's own actions and metrics), so what is left here is a locator
        and a set of global controls: 48px, small type, quiet.

        The title is kept rather than dropped because the rail is `md:hidden`
        on a phone — without this line there is nothing on a narrow screen
        saying where you are.
      */}
      <header className="print:hidden h-12 flex items-center justify-between gap-3 px-4 sm:px-5 border-b border-border bg-background/85 backdrop-blur-sm shrink-0 sticky top-0 z-10">
        {/* Logo + page title */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* The wordmark is cream on the supplied artwork, which disappears
              on the light header, so each theme gets the variant it can show.
              Two tags rather than one recoloured by CSS: the chevron beside it
              keeps its own three colours on both. The `md:hidden` lives on the
              wrapper, so the breakpoint and the theme never have to out-specify
              each other. */}
          <span className="md:hidden shrink-0">
            <Image
              src="/logo-light.png"
              alt="Ber Wilson"
              width={640}
              height={339}
              className="object-contain h-5 w-auto dark:hidden"
              priority
            />
            <Image
              src="/logo-dark.png"
              alt=""
              aria-hidden
              width={640}
              height={343}
              className="object-contain h-5 w-auto hidden dark:block"
              priority
            />
          </span>
          {/* `tracking-[-0.02em]`, not `heading-tight`: that utility also sets
              `text-wrap: balance`, which resets the wrap half of `white-space`
              and so silently defeated `truncate` — the title wrapped to two
              lines in the band between the mobile and sidebar layouts. */}
          {/*
            ⚠ STILL AN `<h1>`, THOUGH IT NO LONGER LOOKS LIKE ONE — and that is
            a deliberate stop, not an oversight. Measured 2026-10-27: 48 of the
            97 `page.tsx` files render a heading of their own, so for the other
            49 THIS IS THE DOCUMENT'S ONLY `<h1>`. Demoting it to a span is a
            one-line change that silently removes the heading from half the
            application, which no test here can see.

            So the weight came down and the element stayed. The visible masthead
            is `PageHeader`; this is the locator, and it is the heading only
            until the page beneath it grows its own.
          */}
          <h1 className="truncate text-sm font-medium tracking-[-0.01em] text-muted-foreground">
            {pageTitle(pathname)}
          </h1>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isAdmin && (
          <>
          {/* Ask Ber AI — ambient agent, available everywhere */}
          <button
            onClick={() => openDock('open-ber-ai')}
            className="hidden md:flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
            aria-label="Ask Ber AI"
          >
            <Sparkles size={14} />
            <span className="text-xs font-medium">
              {unread > 0 ? `${unread} answer${unread === 1 ? '' : 's'} ready` : 'Ask Ber AI'}
            </span>
            {unread > 0 ? (
              <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                {unread}
              </span>
            ) : (
              <kbd className="ml-1 inline-flex items-center rounded border border-primary/20 bg-background px-1.5 py-0.5 text-[10px] font-medium">
                ⌘J
              </kbd>
            )}
          </button>
          <button
            onClick={() => openDock('open-ber-ai')}
            className="relative p-2 rounded-md text-primary hover:bg-primary/10 transition-colors md:hidden"
            aria-label={unread > 0 ? `Ask Ber AI — ${unread} answer${unread === 1 ? '' : 's'} ready` : 'Ask Ber AI'}
          >
            <Sparkles size={16} />
            {unread > 0 && (
              <span className="absolute right-1 top-1 size-2 rounded-full bg-primary ring-2 ring-background" />
            )}
          </button>

          {/* Desktop search trigger — looks like a search box, opens the palette.
              Given real width (it was a 90px token button): search is the
              primary way around a CRM, and every reference app in the brief
              puts a full-width field here rather than an icon. */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden md:flex w-56 lg:w-72 items-center gap-2 h-8 pl-2.5 pr-2 rounded-lg border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
            aria-label="Search"
          >
            <Search size={14} className="shrink-0" />
            <span className="text-xs">Search projects, people, documents…</span>
            <kbd className="ml-auto inline-flex shrink-0 items-center rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium">
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
            href="https://drive.google.com/drive/folders/0ANJNCh7N8A9MUk9PVA"
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

          {/* Every role gets the bell — knowing what a teammate just filed is
              not a cross-portfolio privilege, and the API scopes each inbox to
              its own team member. */}

          <UserMenu email={email} />
        </div>
      </header>

      {isAdmin && paletteOpen && <CommandPalette onClose={closePalette} />}
    </>
  )
}
