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
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Sort:</span>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setSort(opt.value)}
          className={cn(
            'h-7 px-2.5 rounded text-xs font-medium transition-colors',
            current === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-accent'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
