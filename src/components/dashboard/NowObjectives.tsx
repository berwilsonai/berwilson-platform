'use client'

import { useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { applyMove, type Move } from '@/lib/ui/dnd'
import NowObjectivesList, { type NowObjectiveItem } from './NowObjectivesList'

export type { NowObjectiveItem } from './NowObjectivesList'

/**
 * Owns the router and the reorder write, and nothing a reader sees.
 *
 * ⚠ SPLIT OUT FOR THE SAME REASON `AttentionClient` AND `OpportunitiesClient`
 * ARE: `useRouter` throws outside a Next request, so anything importing it is
 * unverifiable by `renderToStaticMarkup`. Keeping it here leaves
 * `NowObjectivesList` — the numbering, the health chip, three optional meta
 * fields and a handle per row — renderable in a test.
 */
export default function NowObjectives({ items }: { items: NowObjectiveItem[] }) {
  const router = useRouter()

  /*
    ⚠ THE REFRESH IS ON THE TRAILING EDGE. The order is read by a server
    component, so without it the dashboard keeps rendering the old numbering on
    the next soft navigation back (§12). Debounced, because nudging an
    objective up two places is two moves and should cost one round-trip.
    Cleared on unmount, or it fires against a page already navigated away from.
  */
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => router.refresh(), 600)
  }, [router])

  const onReorder = useCallback(
    async (move: Move) => {
      /*
        The payload is rebuilt from the NEW arrangement via `applyMove`, the
        same tested function the hook itself uses — so the remove-before-insert
        off-by-one is not re-derived here.

        ⚠ Sequential 0..n-1 over the whole bucket is correct and complete ONLY
        because the dashboard query has no LIMIT: it reads every active `now`
        objective (verified in dashboard/page.tsx, 2026-10-26). If that ever
        gains a limit, this becomes a partial reorder writing authoritative
        sort_orders over rows it cannot see.
      */
      const ordered = applyMove(items, move, (o) => o, () => 'now')
      const payload = ordered.map((o, i) => ({ id: o.id, bucket: 'now', sort_order: i }))
      const res = await fetch('/api/objectives/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: null }))
        toast.error(error ?? 'Could not save the new order')
        // Throwing is what rolls the optimistic arrangement back.
        throw new Error('reorder failed')
      }
      scheduleRefresh()
    },
    [items, scheduleRefresh]
  )

  return <NowObjectivesList items={items} onReorder={onReorder} />
}
