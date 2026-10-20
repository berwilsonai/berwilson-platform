'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'

import InvestorCards, { type InvestorCardData } from './InvestorCards'

export type { InvestorCardData }

/**
 * Owns the router and the optimistic removal, and nothing a reader sees.
 *
 * ⚠ SPLIT OUT FOR THE SAME REASON `AttentionClient` IS — `useRouter` throws
 * outside a Next request, so keeping it here leaves `InvestorCards` renderable
 * in a test. ⚠ And the state is an OVERLAY of what this session removed, never
 * a copy of `items`: the cards come from a server component, so state seeded
 * from props would never see a `router.refresh()`, and syncing it back with an
 * effect is the lint pattern §9 already carries eleven of.
 *
 * `InvestorCardData` is re-exported because the page imports it from here, and
 * moving that import would be churn in a file this change has no business
 * touching.
 */
export default function InvestorsClient({
  items,
  canDelete = false,
}: {
  items: InvestorCardData[]
  canDelete?: boolean
}) {
  const router = useRouter()
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())

  const onDeleted = useCallback(
    (id: string) => {
      setRemoved((prev) => new Set(prev).add(id))
      router.refresh()
    },
    [router]
  )

  return (
    <InvestorCards
      items={items.filter(({ investor }) => !removed.has(investor.id))}
      canDelete={canDelete}
      onDeleted={onDeleted}
    />
  )
}
