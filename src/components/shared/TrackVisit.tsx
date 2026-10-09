'use client'

import { useEffect } from 'react'
import { recordVisit, type RecentKind } from '@/lib/recents'

/**
 * Remember that this record was opened. Renders nothing.
 *
 * Mounted by a record's page or layout, which is the only place that knows
 * what the record is CALLED — the app shell sees a URL and a page title, and
 * "Projects" is not the name of the deal the reader wants to get back to.
 *
 * Adding a record type is one line in that type's page: there is no registry
 * here to keep in step.
 */
export default function TrackVisit({
  kind,
  label,
  href,
}: {
  kind: RecentKind
  label: string
  href: string
}) {
  useEffect(() => {
    recordVisit({ kind, label, href })
  }, [kind, label, href])

  return null
}
