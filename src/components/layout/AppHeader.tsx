'use client'

import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
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

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="h-14 flex items-center justify-between px-4 sm:px-6 border-b border-border bg-background shrink-0">
      {/* Logo + page title */}
      <div className="flex items-center gap-2.5">
        <Image
          src="/logo.png"
          alt="Ber Wilson"
          width={100}
          height={54}
          className="object-contain h-5 w-auto md:hidden"
          priority
        />
        <div className="hidden md:hidden w-px h-4 bg-border" />
        <h1 className="text-sm font-semibold tracking-tight">{getPageTitle(pathname)}</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="size-7 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center shrink-0">
            {initials(email)}
          </div>
          <span className="text-xs text-muted-foreground hidden sm:block max-w-[160px] truncate">
            {email}
          </span>
        </div>

        <button
          onClick={handleSignOut}
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut size={15} />
        </button>
      </div>
    </header>
  )
}
