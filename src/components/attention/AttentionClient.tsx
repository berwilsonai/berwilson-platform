'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

import AttentionList, { type AttentionRow } from './AttentionList'

export type { AttentionRow }

/**
 * Supplies `AttentionList` with the filter from the URL, and nothing else.
 *
 * ⚠ THE FILTER LIVES IN THE URL, NOT IN STATE. §12: a filter kept only in
 * component state is not a view. "Show me the overdue diligence" has to be
 * something one executive can send the other, and a refresh must not wipe it —
 * which is the bug the task board and the projects search still have.
 *
 * This file exists so the list itself can be rendered in a test: the two
 * navigation hooks below throw outside a Next request, so anything importing
 * them is unverifiable by `renderToStaticMarkup`.
 */
export default function AttentionClient({ items }: { items: AttentionRow[] }) {
  const router = useRouter()
  const params = useSearchParams()

  const onFilter = useCallback(
    (kind: string | null) => {
      const next = new URLSearchParams(params.toString())
      if (kind) next.set('kind', kind)
      else next.delete('kind')
      router.replace(next.toString() ? `/attention?${next}` : '/attention', { scroll: false })
    },
    [params, router]
  )

  const onOpen = useCallback((href: string) => router.push(href), [router])

  return (
    <AttentionList items={items} active={params.get('kind')} onFilter={onFilter} onOpen={onOpen} />
  )
}
