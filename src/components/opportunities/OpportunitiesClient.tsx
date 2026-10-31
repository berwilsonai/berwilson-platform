'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Kanban, LayoutGrid } from 'lucide-react'

import type { Opportunity } from '@/lib/supabase/types'
import { useStoredState } from '@/hooks/use-stored-state'
import { Segmented } from '@/components/ui/segmented'
import {
  OPPORTUNITY_STAGE_LABELS,
} from '@/lib/utils/opportunities'
import OpportunityCards from './OpportunityCards'
import OpportunityBoard from './OpportunityBoard'
import { phaseLookup, powerTotal } from '@/lib/records/power'
import type { PhaseRow } from '@/lib/records/power-read'
import type { DealStage } from '@/lib/supabase/types'

type View = 'board' | 'grid'

/**
 * Owns the router and the optimistic removal, and nothing a reader sees.
 *
 * ⚠ SPLIT OUT FOR THE SAME REASON `AttentionClient` IS. `useRouter` throws
 * outside a Next request, so anything importing it is unverifiable by
 * `renderToStaticMarkup` — keeping it here leaves `OpportunityCards`, which is
 * all nine conditional fields and every class string, renderable in a test.
 *
 * ⚠ AND THE STATE IS AN OVERLAY OF WHAT THIS SESSION REMOVED, NEVER A COPY OF
 * THE LIST. `useState(props.opportunities)` would be a second source of truth:
 * the cards arrive from a server component, so a `router.refresh()` delivers new
 * props to this same mounted component and state seeded from props would never
 * see them — and syncing it back with an effect is the
 * `react-hooks/set-state-in-effect` pattern §9 already carries eleven of. A set
 * of removed ids applied as a filter has no such moment: once the refresh lands,
 * the server's answer already omits the row and the overlay is a no-op.
 */
export default function OpportunitiesClient({
  opportunities,
  canDelete = false,
  phases = [],
}: {
  opportunities: Opportunity[]
  canDelete?: boolean
  /**
   * Every ramp phase for the opportunities above, as plain rows.
   *
   * ⚠ ROWS, NOT A LOOKUP — a `PhaseLookup` is a closure and a server component
   * may hand a client only plain data. Rebuilt here once, in a memo.
   */
  phases?: PhaseRow[]
}) {
  const powerOf = useMemo(() => phaseLookup(phases), [phases])
  const router = useRouter()
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  const [view, setView] = useStoredState<View>('bw.opportunities.view', 'board')

  const onDeleted = useCallback(
    (id: string) => {
      setRemoved((prev) => new Set(prev).add(id))
      // The list is a server component and would otherwise keep rendering the
      // deleted row from cache on the next navigation back to it.
      router.refresh()
    },
    [router]
  )

  /*
    The status write behind a drag.

    ⚠ IT LIVES HERE, NOT IN THE BOARD, FOR THE REASON THIS FILE ALREADY
    EXISTS: `useRouter` throws outside a Next request, so anything reading it
    cannot be exercised by `renderToStaticMarkup`. The board carries the lanes,
    the totals and nine conditional fields per card — keeping the router out of
    it is what keeps all of that testable. That is the third time this split has
    been made (AttentionClient, CommitmentsLedger, here), which §12 records as
    the house pattern rather than a one-off.

    ⚠ AND THE REFRESH IS ON THE TRAILING EDGE. A drag writes one row, but every
    column total, the pipeline header and the sidebar badge are server-rendered
    — §12: an optimistic mutation with no router.refresh() leaves every
    server-rendered count lying until the tab is reloaded. Debounced, because
    moving three cards in a row should cost one round-trip, not three.
  */
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => router.refresh(), 600)
  }, [router])

  const onMoved = useCallback(
    async (id: string, status: DealStage) => {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: null }))
        toast.error(error ?? `Could not move to ${OPPORTUNITY_STAGE_LABELS[status]}`)
        // Throwing is the signal that rolls the card back to where it was.
        throw new Error('status move failed')
      }
      toast.success(`Moved to ${OPPORTUNITY_STAGE_LABELS[status]}`)
      scheduleRefresh()
    },
    [scheduleRefresh]
  )

  const shown = opportunities.filter((o) => !removed.has(o.id))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Segmented
          label="Opportunity view"
          value={view}
          onChange={setView}
          options={[
            { value: 'board', label: 'Pipeline', icon: Kanban },
            { value: 'grid', label: 'Cards', icon: LayoutGrid, count: shown.length },
          ]}
        />
      </div>

      {view === 'board' ? (
        <OpportunityBoard
          opportunities={shown}
          canDelete={canDelete}
          onDeleted={onDeleted}
          onMoved={onMoved}
          powerOf={powerOf}
        />
      ) : (
        <OpportunityCards
          opportunities={shown}
          canDelete={canDelete}
          onDeleted={onDeleted}
          powerOf={(id) => powerTotal(powerOf(id))}
        />
      )}
    </div>
  )
}
