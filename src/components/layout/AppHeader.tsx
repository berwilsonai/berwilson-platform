'use client'

import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useRef, useCallback } from 'react'
import { LogOut, Search, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/attention': 'Attention',
  '/projects': 'Projects',
  '/calendar': 'Calendar',
  '/briefs': 'Briefs',
  '/contacts': 'Contacts',
  '/vendors': 'Vendors',
  '/company': 'Ber Wilson',
  '/review': 'Review Queue',
  '/email-log': 'Email Log',
  '/activity': 'Activity',
  '/intel': 'Intel',
  '/portfolio': 'Portfolio',
  '/equity': 'Equity & Valuation',
  '/proposals/intake': 'Intake Proposal',
}

const SEARCH_PAGES = [
  { href: '/dashboard', label: 'Dashboard', keywords: 'home overview' },
  { href: '/attention', label: 'Attention', keywords: 'alerts urgent overdue' },
  { href: '/projects', label: 'Projects', keywords: 'pipeline deals' },
  { href: '/proposals/intake', label: 'Intake Proposal', keywords: 'ingest upload document' },
  { href: '/briefs', label: 'Briefs', keywords: 'intelligence summary ai' },
  { href: '/intel', label: 'Intel', keywords: 'ask query search ai' },
  { href: '/calendar', label: 'Calendar', keywords: 'schedule dates milestones' },
  { href: '/contacts', label: 'Contacts', keywords: 'people parties rolodex' },
  { href: '/vendors', label: 'Vendors', keywords: 'companies organizations subs' },
  { href: '/company', label: 'Ber Wilson', keywords: 'entities corporate structure' },
  { href: '/portfolio', label: 'Portfolio', keywords: 'finance investments value' },
  { href: '/equity', label: 'Equity & Valuation', keywords: 'cap table investor deal' },
  { href: '/review', label: 'Review Queue', keywords: 'pending approve reject' },
  { href: '/email-log', label: 'Email Log', keywords: 'messages correspondence' },
  { href: '/activity', label: 'Activity', keywords: 'audit log history changes' },
]

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
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = query.trim()
    ? SEARCH_PAGES.filter(
        (p) =>
          p.label.toLowerCase().includes(query.toLowerCase()) ||
          p.keywords.includes(query.toLowerCase())
      )
    : SEARCH_PAGES

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      setQuery('')
    }
  }, [searchOpen])

  const handleNav = useCallback(
    (href: string) => {
      setSearchOpen(false)
      router.push(href)
    },
    [router]
  )

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
          <h1 className="text-base font-semibold tracking-tight text-foreground truncate">{getPageTitle(pathname)}</h1>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Search button — visible on mobile */}
          <button
            onClick={() => setSearchOpen(true)}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors md:hidden"
            aria-label="Search pages"
          >
            <Search size={16} />
          </button>

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

      {/* Mobile command palette / search */}
      {searchOpen && (
        <div className="md:hidden fixed inset-0 z-[70] flex flex-col">
          <div className="absolute inset-0 bg-background/95 backdrop-blur-md" />
          <div className="relative flex flex-col h-full">
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 h-14 border-b border-border">
              <Search size={16} className="text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pages..."
                className="flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <button
                onClick={() => setSearchOpen(false)}
                className="p-2 -mr-2 rounded-full hover:bg-muted transition-colors"
              >
                <X size={18} className="text-muted-foreground" />
              </button>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {filtered.map(({ href, label }) => {
                const active = pathname === href || pathname.startsWith(href + '/')
                return (
                  <button
                    key={href}
                    onClick={() => handleNav(href)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-lg text-left transition-colors ${
                      active
                        ? 'bg-muted text-foreground font-medium'
                        : 'text-foreground/80 hover:bg-muted/60 active:bg-muted'
                    }`}
                  >
                    <span className="text-sm">{label}</span>
                    {active && (
                      <span className="ml-auto text-xs text-muted-foreground">Current</span>
                    )}
                  </button>
                )
              })}
              {filtered.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-10">No pages match &ldquo;{query}&rdquo;</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
