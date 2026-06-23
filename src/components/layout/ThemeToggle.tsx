'use client'

import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'

/**
 * Light/dark toggle. The initial class is set pre-paint by the inline script in
 * layout.tsx; this reflects and flips it, persisting the choice to localStorage.
 * Dark mode is opt-in only — production renders light unless the user switches.
 */
export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  function toggle() {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      onClick={toggle}
      className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {/* Icon depends on client-only theme state; suppress the hydration diff. */}
      <span suppressHydrationWarning>{isDark ? <Sun size={15} /> : <Moon size={15} />}</span>
    </button>
  )
}
