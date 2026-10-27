'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

function initials(email: string): string {
  const parts = email.split('@')[0].split(/[._-]/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return email.slice(0, 2).toUpperCase()
}

/**
 * Avatar dropdown in the header: who is signed in, and the way out.
 *
 * ⚠ THE THEME TOGGLE WAS REMOVED 2026-10-27. The app is light; see the note on
 * the pre-paint script in layout.tsx. Leaving the toggle while the pre-paint
 * script ignores the key it writes would be a control that appears to work and
 * does not survive a reload — worse than no control.
 */
export default function UserMenu({ email }: { email: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
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
