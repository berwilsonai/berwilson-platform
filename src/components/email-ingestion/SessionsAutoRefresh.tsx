'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Rendered only while a research run is in flight — re-fetches the server
 * component so the `running` row flips to Needs review / Failed without a
 * manual reload.
 */
export default function SessionsAutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(t)
  }, [router, intervalMs])
  return null
}
