// Internal-vs-external revenue trend — pure divs (no chart library), one
// stacked column per period. Ber Wilson (internal) fills the bottom in the
// brand color; external clients stack on top in slate. This is the picture we
// show Dino: the Ber Wilson slice growing over time.

import { cn } from '@/lib/utils'
import { formatValue } from '@/lib/utils/constants'
import type { PeriodBucket } from '@/lib/utils/dino'

export default function RevenueSplitBar({ buckets }: { buckets: PeriodBucket[] }) {
  const maxTotal = Math.max(0, ...buckets.map((b) => b.total))

  if (maxTotal === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 elev-1">
        <SplitBarHeader />
        <p className="py-8 text-center text-sm text-muted-foreground">No revenue recorded in this range yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 elev-1">
      <SplitBarHeader />
      <div className="mt-4 flex items-end gap-1.5 h-36">
        {buckets.map((b) => {
          const internalPct = (b.internal / maxTotal) * 100
          const externalPct = (b.external / maxTotal) * 100
          return (
            <div
              key={b.key}
              className="group relative flex-1 min-w-0 h-full flex flex-col justify-end"
              title={`${b.label}: ${formatValue(b.total)} — ${formatValue(b.internal)} Ber Wilson, ${formatValue(b.external)} external`}
            >
              {/* hover value */}
              {b.total > 0 && (
                <span className="pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] tnum text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {formatValue(b.total)}
                </span>
              )}
              <div
                className={cn('bg-slate-300 dark:bg-slate-600', b.external > 0 && 'rounded-t-sm', b.internal === 0 && 'rounded-b-sm')}
                style={{ height: `${externalPct}%` }}
              />
              <div
                className={cn('bg-primary', b.internal > 0 && 'rounded-b-sm', b.external === 0 && 'rounded-t-sm')}
                style={{ height: `${internalPct}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {buckets.map((b) => (
          <div key={b.key} className="flex-1 min-w-0 text-center">
            <span className="text-[10px] text-muted-foreground truncate block">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SplitBarHeader() {
  const dot = 'inline-block size-2 rounded-full'
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="label-caps text-muted-foreground">Revenue by source</h2>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className={cn(dot, 'bg-primary')} /> Ber Wilson</span>
        <span className="inline-flex items-center gap-1"><span className={cn(dot, 'bg-slate-300 dark:bg-slate-600')} /> External</span>
      </div>
    </div>
  )
}
