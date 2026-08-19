import { formatValue } from '@/lib/utils/constants'
import { ACCELERATOR_THRESHOLD } from '@/lib/utils/steel'
import type { RepScorecard } from '@/lib/steel/rollups'

interface Props {
  scorecards: RepScorecard[]
  year: number
  /** Heading; defaults to "Rep Scorecards". */
  title?: string
}

/** Accelerator progress bar: collected profit this year toward $1M. */
function AccelBar({ collected, accelerated }: { collected: number; accelerated: boolean }) {
  const pct = Math.min(100, (collected / ACCELERATOR_THRESHOLD) * 100)
  return (
    <div className="min-w-[120px]">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="tnum text-muted-foreground">{formatValue(collected)}</span>
        {accelerated ? (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30">
            +1pt active
          </span>
        ) : (
          <span className="tnum text-muted-foreground/70">{pct.toFixed(0)}%</span>
        )}
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={accelerated ? 'h-full bg-emerald-500' : 'h-full bg-primary'}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function RepScorecardTable({ scorecards, year, title = 'Rep Scorecards' }: Props) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 elev-1">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="label-caps text-muted-foreground">{title}</h2>
        <span className="text-[11px] text-muted-foreground">
          Accelerator: {year} collected profit toward {formatValue(ACCELERATOR_THRESHOLD)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
              <th className="font-medium pb-2 pr-3">Rep</th>
              <th className="font-medium pb-2 px-3 text-right">Sales</th>
              <th className="font-medium pb-2 px-3 text-right">Profit</th>
              <th className="font-medium pb-2 px-3 text-right">Owed</th>
              <th className="font-medium pb-2 px-3 text-right">Paid</th>
              <th className="font-medium pb-2 px-3 text-right">Projected</th>
              <th className="font-medium pb-2 pl-3">Accelerator</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {scorecards.map((c) => (
              <tr key={c.memberId} className="border-t border-border align-top">
                <td className="py-2 pr-3 font-medium align-middle">{c.name}</td>
                <td className="py-2 px-3 text-right align-middle">{formatValue(c.totalSales)}</td>
                <td className="py-2 px-3 text-right align-middle">{formatValue(c.totalProfit)}</td>
                <td className="py-2 px-3 text-right align-middle text-amber-600 dark:text-amber-400">
                  {formatValue(c.totalOwed)}
                </td>
                <td className="py-2 px-3 text-right align-middle text-emerald-600 dark:text-emerald-400">
                  {formatValue(c.totalPaid)}
                </td>
                <td className="py-2 px-3 text-right align-middle text-muted-foreground">
                  {formatValue(c.totalProjected)}
                </td>
                <td className="py-2 pl-3">
                  <AccelBar collected={c.collectedProfitYTD} accelerated={c.accelerated} />
                </td>
              </tr>
            ))}
            {scorecards.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-center text-xs text-muted-foreground">
                  No rep activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Sales = revenue on their deals · Profit = commissionable margin they generated · Owed/Paid = collected deals ·
        Projected = open deals (not yet payable).
      </p>
    </section>
  )
}
