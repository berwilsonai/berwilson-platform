'use client'

/**
 * The thin router-aware wrapper around the ledger.
 *
 * ⚠ THE WHOLE SCREEN USED TO LIVE HERE AND COULD NOT BE RENDERED IN A TEST.
 * `useRouter`/`useSearchParams` throw "invariant expected app router to be
 * mounted" outside a Next request, so `renderToStaticMarkup` could not touch
 * it — and §12 records that behind auth a curl returns the same redirect
 * whether a route answers or throws, so there was no way at all to assert what
 * a reader sees. `AttentionList` was split for this exact reason on 10-17 and
 * `OpportunityNotes` again on 10-18; this is the third, which is the point at
 * which it is the house pattern rather than a one-off.
 *
 * Everything a reader sees is in `CommitmentsLedger`. This supplies the one
 * thing that needs the request: turning a filter into a URL.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import CommitmentsLedger from './CommitmentsLedger'
import type {
  CommitmentListItem,
  CommitmentListFilters,
  CommitmentListResult,
} from '@/lib/commitments/list'

export default function CommitmentsClient(props: {
  items: CommitmentListItem[]
  totals: CommitmentListResult['totals']
  filters: CommitmentListFilters
  mailboxes: string[]
  loadError: string | null
  withheld: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  /**
   * Move a filter into the URL.
   *
   * ⚠ THE FILTERS LIVE IN THE URL. §12 (10-03): a filter kept only in
   * component state is not a view — it cannot be linked, bookmarked or sent to
   * anyone, which reads as the thing having no page.
   *
   * `router.replace` rather than `window.location.href`: the row set comes
   * from the server, so the view genuinely has to be re-fetched — but a
   * client-side navigation re-renders the one page instead of reloading the
   * app shell, and assigning to `window.location` is a mutation the React
   * Compiler refuses outright. `replace` rather than `push` keeps the back
   * button meaning "the page before this one" rather than walking back through
   * filter changes.
   *
   * The ledger's search box is NOT routed — it filters rows already in hand,
   * so typing never touches the server.
   */
  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  return <CommitmentsLedger {...props} setParam={setParam} />
}
