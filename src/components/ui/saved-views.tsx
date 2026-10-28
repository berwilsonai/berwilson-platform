'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { Bookmark, BookmarkPlus, X } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { normalizeQuery, type SavedView } from '@/lib/views/saved'

/**
 * Named filter sets for a list page.
 *
 * ⚠ CHOOSING A VIEW NAVIGATES TO ITS FILTERS; IT DOES NOT "APPLY" ANYTHING.
 * The href is the stored query plus `?view=<slug>` as a label, so the URL in
 * the address bar always describes what is on screen and a pasted link means
 * the same thing to whoever opens it. That is the whole reason this is a
 * shared table rather than `localStorage`: the version that was refused made a
 * bare `/projects` render differently per reader with no way for a link's
 * sender to tell (see `url-facets.tsx`, which still carries the prohibition).
 *
 * ⚠ THE HIGHLIGHT COMPARES THE FILTERS, NOT THE LABEL. `?view=` is only a
 * name; a reader who edits a facet afterwards is no longer looking at the
 * saved view, and the chip must stop claiming they are. Both sides go through
 * `normalizeQuery`, so key order never makes two identical filter sets look
 * different.
 */
export default function SavedViews({
  views,
  className,
}: {
  views: SavedView[]
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [saving, setSaving] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [pendingDelete, setPendingDelete] = useState<SavedView | null>(null)

  const currentQuery = useMemo(
    () => normalizeQuery(searchParams.toString()),
    [searchParams]
  )
  const activeView = useMemo(
    () => views.find((v) => normalizeQuery(v.query) === currentQuery) ?? null,
    [views, currentQuery]
  )

  const go = useCallback(
    (view: SavedView) => {
      const params = new URLSearchParams(view.query)
      params.set('view', view.slug)
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname]
  )

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const res = await fetch('/api/saved-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathname, name: trimmed, query: currentQuery }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The route's refusals carry their own sentence — show that, not a
        // generic failure, or the reader cannot tell a duplicate name from an
        // outage.
        toast.error(body?.error ?? 'Could not save the view.')
        return
      }
      setNaming(false)
      setName('')
      toast.success(`Saved “${trimmed}”.`)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function remove(view: SavedView) {
    const res = await fetch(`/api/saved-views?id=${encodeURIComponent(view.id)}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? 'Could not remove the view.')
      return
    }
    toast.success(`Removed “${view.name}”.`)
    // If the reader was looking at it, the FILTERS stay — only the label goes.
    // A deleted view degrades to a working link, never a broken page.
    router.refresh()
  }

  // Nothing saved and nothing filtered: the row would be an empty invitation
  // to save the unfiltered list, which is the one view that cannot exist.
  if (views.length === 0 && !currentQuery) return null

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {views.length > 0 && (
        <span className="label-caps mr-0.5 text-muted-foreground">Views</span>
      )}

      {views.map((view) => {
        const active = activeView?.id === view.id
        return (
          /*
            ⚠ THE REMOVE CONTROL IS A SIBLING, NOT A CHILD. A <button> inside a
            <button> is invalid and fires both (§12, the same trap that forced
            /attention's rows from Link to div), so the chip and its × sit side
            by side inside one group and the group carries the hover ring.
          */
          <span
            key={view.id}
            className={cn(
              'group inline-flex items-center rounded-full border text-xs transition-colors',
              active
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            )}
          >
            <button
              type="button"
              onClick={() => go(view)}
              aria-current={active ? 'true' : undefined}
              className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full pl-2.5 pr-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0 sm:py-1"
            >
              <Bookmark size={11} aria-hidden="true" />
              {view.name}
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(view)}
              aria-label={`Remove the “${view.name}” view`}
              /*
                ⚠ `group-focus-within`, NOT `group-hover` ALONE — a control that
                only appears on hover does not exist on a phone or to a keyboard
                (§12). It is always present at touch widths and reveals on
                hover or focus from `sm` up.
              */
              className="mr-1 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground/60 outline-none transition-opacity hover:text-critical focus-visible:ring-3 focus-visible:ring-ring/50 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            >
              <X size={11} aria-hidden="true" />
            </button>
          </span>
        )
      })}

      {/*
        The save affordance only exists when there is something to save and it
        is not already saved — otherwise it offers to make a duplicate of the
        view the reader is looking at.
      */}
      {currentQuery && !activeView && (
        naming ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
                if (e.key === 'Escape') setNaming(false)
              }}
              placeholder="Name this view"
              aria-label="Name this view"
              className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !name.trim()}
              className="inline-flex h-8 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setNaming(false)}
              className="inline-flex h-8 items-center rounded-md px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-xs text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0 sm:py-1"
          >
            <BookmarkPlus size={11} aria-hidden="true" />
            Save this view
          </button>
        )
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={pendingDelete ? `Remove “${pendingDelete.name}”?` : ''}
        description="The filters stay in the address bar — only the saved name goes, and for everyone."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          const view = pendingDelete
          setPendingDelete(null)
          if (view) void remove(view)
        }}
      />
    </div>
  )
}
