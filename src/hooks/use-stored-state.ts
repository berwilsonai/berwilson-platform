'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * useState that persists to localStorage, scoped per browser. Used for
 * per-user view preferences (filters, layout, presets) without a backend.
 * Safe during SSR — reads from storage only after mount.
 */
export function useStoredState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial)
  const [hydrated, setHydrated] = useState(false)

  // Read once on mount
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw !== null) setValue(JSON.parse(raw) as T)
    } catch {
      /* ignore corrupt/unavailable storage */
    }
    setHydrated(true)
  }, [key])

  // Write on change (after hydration so we don't clobber stored value with the default)
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  }, [key, value, hydrated])

  const set = useCallback((v: T) => setValue(v), [])
  return [value, set]
}
