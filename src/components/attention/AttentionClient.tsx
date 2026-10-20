'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  ATTENTION_DISMISS_DAYS,
  attentionDeleteTarget,
} from '@/lib/attention-kinds'
import AttentionList, { type AttentionRow, type DismissedRow } from './AttentionList'

export type { AttentionRow, DismissedRow }

/**
 * Supplies `AttentionList` with the filter from the URL and every write.
 *
 * ⚠ THE FILTER LIVES IN THE URL, NOT IN STATE. §12: a filter kept only in
 * component state is not a view. "Show me the overdue diligence" has to be
 * something one executive can send the other, and a refresh must not wipe it —
 * which is the bug the task board and the projects search still have. The
 * Dismissed tab is in the URL for the same reason.
 *
 * This file exists so the list itself can be rendered in a test: the two
 * navigation hooks below throw outside a Next request, so anything importing
 * them is unverifiable by `renderToStaticMarkup`. The quick actions kept that
 * split — the list takes `onDismiss`/`onDelete`/`onRestore` as callbacks and
 * knows nothing about fetch, so every row shape including the busy and
 * delete-less ones stays checkable.
 *
 * ── HOW THE OPTIMISTIC REMOVAL WORKS, AND WHY IT IS NOT A COPY OF `items` ────
 *
 * ⚠ `useState(props.items)` WOULD BE A SECOND SOURCE OF TRUTH AND WOULD GO
 * STALE. The items arrive from a server component, so a `router.refresh()`
 * delivers new props to the SAME mounted component — state seeded from props
 * would never see them, and syncing it back with an effect is the
 * `react-hooks/set-state-in-effect` pattern §9 already carries eleven of.
 *
 * So the local state is an OVERLAY of what this session has changed, never a
 * copy of the list: two sets of keys, applied as filters over the real props.
 * After the refresh lands, the server's answer already omits the dismissed row
 * and the overlay becomes a harmless no-op — there is no moment where the two
 * can disagree, and nothing to reconcile.
 */
export default function AttentionClient({
  items,
  dismissed,
}: {
  items: AttentionRow[]
  dismissed: DismissedRow[]
}) {
  const router = useRouter()
  const params = useSearchParams()

  /** Keys this session has removed from the open list (dismissed or deleted). */
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  /** Keys this session has restored, so they leave the Dismissed list at once. */
  const [restored, setRestored] = useState<ReadonlySet<string>>(new Set())
  /** Keys with a write in flight. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  /** The row awaiting a confirmation, if any. */
  const [pendingDelete, setPendingDelete] = useState<AttentionRow | null>(null)

  const mark = useCallback(
    (set: (fn: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void, key: string, on: boolean) => {
      set((prev) => {
        const next = new Set(prev)
        if (on) next.add(key)
        else next.delete(key)
        return next
      })
    },
    []
  )

  const onFilter = useCallback(
    (kind: string | null) => {
      const next = new URLSearchParams(params.toString())
      if (kind) next.set('kind', kind)
      else next.delete('kind')
      router.replace(next.toString() ? `/attention?${next}` : '/attention', { scroll: false })
    },
    [params, router]
  )

  const onView = useCallback(
    (view: 'open' | 'dismissed') => {
      const next = new URLSearchParams(params.toString())
      if (view === 'dismissed') next.set('view', 'dismissed')
      else next.delete('view')
      router.replace(next.toString() ? `/attention?${next}` : '/attention', { scroll: false })
    },
    [params, router]
  )

  const onOpen = useCallback((href: string) => router.push(href), [router])

  /**
   * Put an item back. Also the Undo on the dismissal toast, which is why it is
   * one function: §12 learned on the commitment ledger that an automatic pass
   * and its undo have to run the same path, or the undo works once.
   */
  const restore = useCallback(
    async (itemKey: string) => {
      mark(setBusy, itemKey, true)
      try {
        const res = await fetch('/api/attention/dismiss', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemKey }),
        })
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(json.error ?? 'Could not restore that item.')
        }
        mark(setRestored, itemKey, true)
        mark(setRemoved, itemKey, false)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not restore that item.')
      } finally {
        mark(setBusy, itemKey, false)
      }
    },
    [mark, router]
  )

  const onDismiss = useCallback(
    async (row: AttentionRow) => {
      mark(setBusy, row.id, true)
      // Optimistic: the row goes now and comes back if the server refuses, so a
      // failure is never silent and a success never waits on a round trip.
      mark(setRemoved, row.id, true)
      try {
        const res = await fetch('/api/attention/dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemKey: row.id }),
        })
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(json.error ?? 'Could not dismiss that item.')
        }
        toast.success(`Dismissed for ${ATTENTION_DISMISS_DAYS} days.`, {
          action: { label: 'Undo', onClick: () => void restore(row.id) },
        })
        router.refresh()
      } catch (err) {
        mark(setRemoved, row.id, false)
        toast.error(err instanceof Error ? err.message : 'Could not dismiss that item.')
      } finally {
        mark(setBusy, row.id, false)
      }
    },
    [mark, restore, router]
  )

  /**
   * Delete the row behind an item, through the route that already owns it.
   *
   * ⚠ CONFIRMED, UNLIKE THE DISMISS, AND THAT ASYMMETRY IS THE POINT. A
   * dismissal is reversible by a button; this destroys a record, and the only
   * way back is `activity_log`'s `to_jsonb(old)` in psql (§4). The list is also
   * terse enough that a row reads as "a line of text" rather than as the task
   * or lead it stands for, so the dialog is where the thing gets NAMED before
   * it goes. The dismiss button beside it is the no-friction option on purpose.
   */
  const runDelete = useCallback(
    async (row: AttentionRow) => {
      const target = attentionDeleteTarget(row.category, row.id)
      if (!target) return
      mark(setBusy, row.id, true)
      mark(setRemoved, row.id, true)
      try {
        const res = await fetch(target.url, { method: 'DELETE' })
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(json.error ?? `Could not delete that ${target.noun}.`)
        }
        toast.success(`${target.noun[0].toUpperCase()}${target.noun.slice(1)} deleted.`)
        router.refresh()
      } catch (err) {
        mark(setRemoved, row.id, false)
        toast.error(err instanceof Error ? err.message : `Could not delete that ${target.noun}.`)
      } finally {
        mark(setBusy, row.id, false)
      }
    },
    [mark, router]
  )

  const openRows = items.filter((i) => !removed.has(i.id))
  const dismissedRows = dismissed.filter((d) => !restored.has(d.item_key))
  const view = params.get('view') === 'dismissed' ? 'dismissed' : 'open'
  const pendingTarget = pendingDelete ? attentionDeleteTarget(pendingDelete.category, pendingDelete.id) : null

  return (
    <>
      <AttentionList
        items={openRows}
        dismissed={dismissedRows}
        active={params.get('kind')}
        view={view}
        busy={busy}
        onFilter={onFilter}
        onView={onView}
        onOpen={onOpen}
        onDismiss={onDismiss}
        onDelete={setPendingDelete}
        onRestore={restore}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={pendingTarget ? `Delete this ${pendingTarget.noun}?` : 'Delete?'}
        description={
          pendingDelete
            ? `"${pendingDelete.title}" will be removed for good. Dismiss it instead if you only want it off this screen for ${ATTENTION_DISMISS_DAYS} days.`
            : undefined
        }
        confirmLabel={pendingTarget ? `Delete ${pendingTarget.noun}` : 'Delete'}
        destructive
        onConfirm={async () => {
          const row = pendingDelete
          setPendingDelete(null)
          if (row) await runDelete(row)
        }}
      />
    </>
  )
}
