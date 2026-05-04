'use client'

import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/projects': 'Projects',
  '/contacts': 'Contacts',
  '/review': 'Review Queue',
  '/activity': 'Activity',
  '/intel': 'Intel',
  '/email-log': 'Email Log',
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
      {/* Logo visible on mobile (sidebar is hidden); page title on desktop */}
      <div className="flex items-center gap-3">
        <Image
          src="/logo.png"
          alt="Ber Wilson"
          width={100}
          height={54}
          className="object-contain h-7 w-auto md:hidden"
          priority
        />
        <h1 className="text-sm font-semibold tracking-tight hidden md:block">{getPageTitle(pathname)}</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="size-7 rounded-full bg-slate-700 text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
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
