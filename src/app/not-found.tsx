import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { Panel } from '@/components/ui/card'
import EmptyState from '@/components/shared/EmptyState'
import { Kbd } from '@/components/ui/kbd'

export const metadata = { title: 'Not found — Ber Wilson Intelligence' }

/**
 * The one 404 for the whole app.
 *
 * ⚠ There were 25 `notFound()` calls and no `not-found.tsx`, so every one of
 * them landed on Next's built-in page: a bare line of text OUTSIDE the app
 * shell, with no sidebar, no header and no way back but the browser's back
 * button. This file renders inside the root layout, so the chrome and the
 * reader's bearings survive a dead link.
 *
 * The copy covers BOTH reasons a record answers 404 here. Most call sites mean
 * "no such row", but the access guards (`canAccessProject` /
 * `canAccessOpportunity` / the confidential rewrite) also answer `notFound()`
 * deliberately — a record a viewer may not see must not be distinguishable
 * from one that does not exist, so this page may never claim it was deleted.
 */
export default function NotFound() {
  return (
    <Panel className="py-4">
      <EmptyState
        icon={FileQuestion}
        title="That page isn't here"
        description="The link may be out of date, the record may have been renamed or removed, or it may be one this account cannot open."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/projects"
              className="inline-flex items-center h-9 px-4 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors"
            >
              Projects
            </Link>
            <Link
              href="/decide"
              className="inline-flex items-center h-9 px-4 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors"
            >
              Decide queue
            </Link>
          </div>
        }
      />
      <p className="pb-6 text-center text-xs text-muted-foreground">
        Press <Kbd>⌘K</Kbd> to
        search for a record by name.
      </p>
    </Panel>
  )
}
