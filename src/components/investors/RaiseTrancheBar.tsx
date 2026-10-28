// Segmented tranche waterfall bar — server-renderable (pure divs).
// Each tranche is a segment sized by its share of the raise; inside, three
// layered fills show funded (solid emerald), committed (indigo), and
// potential-if-indications-convert (soft amber). Sequential fill semantics
// come from fillTranches() — this component only draws.

import { cn } from '@/lib/utils'
import { formatValue } from '@/lib/utils/constants'
import type { TrancheFill } from '@/lib/investors/raises'

interface RaiseTrancheBarProps {
  tranches: TrancheFill[]
  size?: 'sm' | 'lg'
  /** Show the per-tranche labels under the bar (default true). */
  labels?: boolean
}

export default function RaiseTrancheBar({ tranches, size = 'sm', labels = true }: RaiseTrancheBarProps) {
  if (tranches.length === 0) return null
  const barHeight = size === 'lg' ? 'h-4' : 'h-2.5'

  return (
    <div>
      <div className={cn('flex gap-1', barHeight)}>
        {tranches.map((t, idx) => {
          const pct = (v: number) => `${Math.min((v / t.amount) * 100, 100)}%`
          const full = t.funded >= t.amount
          /*
            ⚠ AN EMPTY TRANCHE IS DRAWN AS A SHAPE WAITING TO BE FILLED, NOT
            AS A GREY SLAB. With nothing committed — which is every tranche on
            every raise here today — all four segments rendered as identical
            flat `bg-muted` bars, and the UI audit read the whole control as
            broken rather than as empty: *"a dark track with no visible fill"*.
            A dashed outline on an untouched tranche says the structure is
            real and the money has not arrived; a solid track says the widget
            did not load. Same information, and the difference is whether a
            reader trusts the page.
          */
          const untouched = t.funded + t.committed + t.potential === 0
          return (
            <div
              key={idx}
              className={cn(
                'relative min-w-0 overflow-hidden rounded-full',
                untouched ? 'border border-dashed border-border bg-transparent' : 'bg-muted'
              )}
              style={{ flexGrow: t.amount, flexBasis: 0 }}
              title={`${t.label}: ${formatValue(t.amount)} — ${formatValue(t.funded)} funded, ${formatValue(t.committed)} committed, ${formatValue(t.potential)} potential`}
            >
              <div className="absolute inset-y-0 left-0 bg-caution-surface/50" style={{ width: pct(t.potential) }} />
              <div className="absolute inset-y-0 left-0 bg-indigo-400/80 dark:bg-indigo-500/70" style={{ width: pct(t.committed) }} />
              <div
                className={cn('absolute inset-y-0 left-0 bg-positive', full && 'rounded-full')}
                style={{ width: pct(t.funded) }}
              />
            </div>
          )
        })}
      </div>
      {labels && (
        <div className="mt-1 flex gap-1">
          {tranches.map((t, idx) => (
            <div key={idx} className="min-w-0 truncate" style={{ flexGrow: t.amount, flexBasis: 0 }}>
              <span className={cn('text-muted-foreground', size === 'lg' ? 'text-[11px]' : 'text-[10px]')}>
                {t.label} · <span className="tnum">{formatValue(t.amount)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Legend for the fill colors — render once near a bar. */
export function TrancheBarLegend({ className }: { className?: string }) {
  const dot = 'inline-block size-2 rounded-full'
  return (
    <div className={cn('flex items-center gap-3 text-[10px] text-muted-foreground', className)}>
      <span className="inline-flex items-center gap-1"><span className={cn(dot, 'bg-positive')} /> Funded</span>
      <span className="inline-flex items-center gap-1"><span className={cn(dot, 'bg-indigo-400/80 dark:bg-indigo-500/70')} /> Committed</span>
      <span className="inline-flex items-center gap-1"><span className={cn(dot, 'bg-caution-surface/70')} /> Indicated</span>
    </div>
  )
}
