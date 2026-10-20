'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'

import type { Opportunity } from '@/lib/supabase/types'
import OpportunityCards from './OpportunityCards'

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
}: {
  opportunities: Opportunity[]
  canDelete?: boolean
}) {
  const router = useRouter()
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())

  const onDeleted = useCallback(
    (id: string) => {
      setRemoved((prev) => new Set(prev).add(id))
      // The list is a server component and would otherwise keep rendering the
      // deleted row from cache on the next navigation back to it.
      router.refresh()
    },
    [router]
  )

  return (
    <OpportunityCards
      opportunities={opportunities.filter((o) => !removed.has(o.id))}
      canDelete={canDelete}
      onDeleted={onDeleted}
    />
  )
}
