// The revenue rollup band — total, the Ber Wilson vs external split, and the
// headline metric: Ber Wilson's share of Dino's revenue. Range selector drives
// this + the trend bar (state lives in DinoDashboard).

import { cn } from '@/lib/utils'
import { formatValue } from '@/lib/utils/constants'
import { REVENUE_RANGES, type RevenueRange, type RevenueRollup as Rollup } from '@/lib/utils/dino'

interface Props {
  rollup: Rollup
  range: RevenueRange
  onRangeChange: (range: RevenueRange) => void
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'primary' | 'slate' | 'accent' }) {
  const dot = tone === 'primary' ? 'bg-primary' : tone === 'slate' ? 'bg-slate-400' : null
  return (
    <div className={cn('rounded-xl border border-border bg-card px-4 py-3 elev-1', tone === 'accent' && 'ring-1 ring-inset ring-primary/25')}>
      <p className="flex items-center gap-1.5 label-caps text-muted-foreground">
        {dot && <span className={`size-1.5 rounded-full ${dot}`} />}
        {label}
      </p>
      <p className="text-lg font-semibold tnum mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

export default function RevenueRollup({ rollup, range, onRangeChange }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="label-caps text-muted-foreground">Revenue</h2>
        {/* Range segmented control */}
        <div className="inline-flex rounded-md border border-input bg-background p-0.5">
          {REVENUE_RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => onRangeChange(r.value)}
              className={cn(
                'h-6 px-2.5 rounded text-[11px] font-medium transition-colors',
                range === r.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Total revenue" value={formatValue(rollup.total)} sub="All jobs in range" />
        <Tile label="Ber Wilson" value={formatValue(rollup.internal)} sub="Internal work" tone="primary" />
        <Tile label="External" value={formatValue(rollup.external)} sub="Existing clients" tone="slate" />
        <Tile
          label="Ber Wilson share"
          value={`${rollup.internalPct}%`}
          sub="of Dino's revenue"
          tone="accent"
        />
      </div>
    </div>
  )
}
