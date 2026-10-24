'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Refresh a job page while the job is still moving.
 *
 * ⚠ IT POLLS THE SERVER PAGE RATHER THAN HOLDING ITS OWN COPY OF THE STATE. A
 * job runs for minutes to an hour in another process; a client that fetched
 * once and rendered from memory would be showing a snapshot, and §12's rule is
 * that a cache in the browser for content that lives in the database is not a
 * cache, it is the only copy the page can see. The server page is the truth and
 * this only asks it again.
 */
export default function JobLive({ intervalMs = 6000 }: { intervalMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(id)
  }, [router, intervalMs])

  return null
}
