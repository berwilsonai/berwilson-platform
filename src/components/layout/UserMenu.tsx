'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, LogOut, Moon, Sun } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

function initials(email: string): string {
  const parts = email.split('@')[0].split(/[._-]/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return email.slice(0, 2).toUpperCase()
}

/**
 * Avatar dropdown in the header: shows the signed-in user and consolidates the
 * theme toggle + sign-out into one menu. Theme state mirrors the pre-paint script
 * in layout.tsx (reads/writes the `dark` class + localStorage); dark mode stays
 * opt-in (it does not follow the OS).
 */
export default function UserMenu({ email }: { email: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape while open.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev
      document.documentElement.classList.toggle('dark', next)
      try {
        localStorage.setItem('theme', next ? 'dark' : 'light')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <div className="size-7 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center shrink-0">
          {initials(email)}
        </div>
        <span className="text-xs text-muted-foreground hidden md:block max-w-[160px] truncate">
          {email}
        </span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground hidden md:block transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-56 rounded-lg border border-border bg-popover text-popover-foreground elev-2 p-1 z-20 animate-fade-in-up"
        >
          <div className="px-3 py-2 border-b border-border/60 mb-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Signed in as</p>
            <p className="text-xs font-medium text-foreground truncate">{email}</p>
          </div>

          <button
            role="menuitem"
            onClick={toggleTheme}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-foreground hover:bg-muted transition-colors"
          >
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
            <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
          </button>

          <button
            role="menuitem"
            onClick={handleSignOut}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-foreground hover:bg-muted transition-colors"
          >
            <LogOut size={15} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  )
}
