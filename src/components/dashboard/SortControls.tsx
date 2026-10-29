'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Segmented } from '@/components/ui/segmented'

/**
 * The dashboard's sort order, in the URL.
 *
 * ⚠ THE TRACK-AND-PILL MARKUP USED TO BE HAND-ROLLED HERE, and the version that
 * was carried its own note: *"Same track-and-pill idiom as `Segmented` … if a
 * third of these appears, merge them."* A third appeared on 2026-10-29 (the
 * `/decide` queue's four orders), so it was merged rather than copied again —
 * §12: a shared renderer wired to one surface is worse than no shared renderer.
 *
 * What stays different from `/decide` is deliberate and is the whole reason this
 * file still exists: these options drive the URL through `router.push`, because
 * the dashboard SORTS ON THE SERVER. `/decide` has every row in the browser
 * already and syncs with `replaceState` instead. Two different costs, one
 * control.
 */
const OPTIONS = [
  { value: 'updated', label: 'Last Updated' },
  { value: 'value', label: 'Highest Value' },
  { value: 'actions', label: 'Most Actions' },
] as const

type SortValue = (typeof OPTIONS)[number]['value']

function asSort(raw: string): SortValue {
  return OPTIONS.some((o) => o.value === raw) ? (raw as SortValue) : 'updated'
}

export default function SortControls({ current }: { current: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setSort(value: SortValue) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('sort', value)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Sort:</span>
      <Segmented
        value={asSort(current)}
        onChange={setSort}
        label="Sort order"
        options={OPTIONS}
      />
    </div>
  )
}
