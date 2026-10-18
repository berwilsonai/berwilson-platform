'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * A filter that lives in the URL, which is where a filter belongs.
 *
 * ⚠ §12: A FILTER KEPT ONLY IN COMPONENT STATE IS NOT A VIEW. The task board
 * held six of them in `useState`, so "show me Eric's overdue Weirton tasks" was
 * not a link — it could not be sent to the other executive, could not be
 * bookmarked, and was wiped by a refresh. Same for the projects search and the
 * Decide chips.
 *
 * ⚠ IT WRITES `replace`, NOT `push`. Changing a filter is not navigation: with
 * `push`, Back walks the reader through every dropdown they touched instead of
 * returning them to the page they came from.
 *
 * ⚠ AND THE DEFAULT VALUE IS REMOVED FROM THE URL rather than written into it.
 * A bare URL must mean the default view — that is the whole point of the
 * localStorage replay being deleted from the projects filters, where a bare
 * `/projects` link rendered differently for each executive. If the default were
 * serialised, every shared link would carry four redundant params and the
 * "bare" case would never occur.
 *
 * `allow` validates what comes back. A query string is user input and reaches a
 * database filter: §12 records that a value outside an enum fails the WHOLE
 * query with `22P02` and a null row set, not just that row.
 */
export function useUrlState<T extends string>(
  key: string,
  fallback: T,
  allow?: readonly T[]
): [T, (next: T) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const raw = params.get(key)
  const value = raw !== null && (!allow || (allow as readonly string[]).includes(raw)) ? (raw as T) : fallback

  const set = useCallback(
    (next: T) => {
      const p = new URLSearchParams(params.toString())
      if (!next || next === fallback) p.delete(key)
      else p.set(key, next)
      const qs = p.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, router, pathname, key, fallback]
  )

  return [value, set]
}
