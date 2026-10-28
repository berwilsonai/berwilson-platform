'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { FIELD_CONTROL_SM_CLASS } from '@/lib/utils/field-classes'

/**
 * The filter row for a list page whose filters live in the URL.
 *
 * ── WHY ONE OWNER ────────────────────────────────────────────────────────────
 * `ProjectFilters`, `InvestorFilters` and `OpportunityFilters` were three
 * copies of the same component — the same `flex items-center gap-2 flex-wrap`
 * shell, the same `setParam` built on `URLSearchParams`, the same `w-auto`
 * select class, the same "Clear" affordance — differing only in which facets
 * they listed. §12: never fork a shared pass, add a target. Three forks is how
 * a fourth list page gets a fourth slightly different filter row.
 *
 * ⚠ THE URL IS THE VIEW, AND THAT IS A DECISION THIS COMPONENT INHERITS
 * RATHER THAN MAKES. `ProjectFilters` carried a long comment about the
 * `localStorage` replay that used to mirror these filters and restore them on
 * arrival: it made a bare `/projects` render differently for each executive
 * with no way for the sender of a link to tell, and it re-rendered the list
 * under the reader after hydration. It was removed deliberately. Nothing here
 * may reintroduce per-reader filter state — a filter kept outside the URL is
 * not a view, and a link that means different things to two people is worse
 * than no link.
 *
 * ⚠ NOT STICKY, deliberately. The UI audit asks for a filter bar that pins
 * under the page header, and on most of these pages that would be right — but
 * `/projects` already has a `sticky top-0` table header, and two sticky
 * elements at the same offset overlap rather than stack. Doing it properly
 * means the bar's height as a token that the table header reads, which is a
 * change to make once with both surfaces in hand rather than per page.
 */

export interface UrlFacet {
  /** The query-string key this facet writes. */
  param: string
  /** The option shown when the facet is unset — "All Sectors". */
  allLabel: string
  /** `[value, label]` in the order they should read. */
  options: readonly (readonly [string, string])[]
  /** Current value, passed from the server page that already parsed it. */
  value: string
  /** Accessible name, when `allLabel` is not descriptive enough on its own. */
  label?: string
}

export default function UrlFacets({
  facets,
  className,
  children,
}: {
  facets: readonly UrlFacet[]
  className?: string
  /** Anything that belongs on the row but is not a facet — a count, a toggle. */
  children?: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      const qs = params.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [router, pathname, searchParams]
  )

  const active = facets.filter((f) => f.value)

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {facets.map((f) => (
        <select
          key={f.param}
          value={f.value}
          aria-label={f.label ?? f.allLabel}
          onChange={(e) => setParam(f.param, e.target.value)}
          className={cn(FIELD_CONTROL_SM_CLASS, 'w-auto')}
        >
          <option value="">{f.allLabel}</option>
          {f.options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      ))}

      {/*
        ⚠ "Clear" APPEARS AT ONE ACTIVE FACET, NOT TWO. The audit asks for it
        at ≥2, which is right for a bar whose facets are visible as removable
        chips — the chips are the undo. Here the only sign a filter is on is
        the select's own value, so the escape hatch has to be there as soon as
        there is something to escape from.
      */}
      {active.length > 0 && (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="inline-flex min-h-[2.75rem] items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0 sm:py-1"
        >
          <X size={12} />
          Clear{active.length > 1 ? ` ${active.length} filters` : ''}
        </button>
      )}

      {children}
    </div>
  )
}
