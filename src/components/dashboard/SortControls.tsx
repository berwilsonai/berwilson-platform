'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const OPTIONS = [
  { value: 'updated', label: 'Last Updated' },
  { value: 'value',   label: 'Highest Value' },
  { value: 'actions', label: 'Most Actions' },
] as const

type SortValue = typeof OPTIONS[number]['value']

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
    /*
      Same track-and-pill idiom as `Segmented` — see the note there on why the
      active state stopped being a terracotta fill. Not literally `Segmented`
      only because this one carries a visible "Sort:" label and drives the URL
      rather than local state; if a third of these appears, merge them.
    */
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Sort:</span>
      <div role="group" aria-label="Sort order" className="inline-flex items-center rounded-md bg-muted p-0.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSort(opt.value)}
            aria-pressed={current === opt.value}
            className={cn(
              'h-7 px-2.5 rounded text-xs font-medium transition-colors',
              'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              current === opt.value
                ? 'bg-card text-foreground elev-1'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
