import { Zap } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatMegawatts, type PowerTotal, type SubtreePower } from '@/lib/records/power'

/**
 * The ramp-up total, wherever it is shown.
 *
 * Richard, 2026-10-30: the total MW *"is the key metric"*, and he asked for it
 * *"displayed on every project in a prominent place… shown by the project
 * name"*. That is a request for one figure on a dozen surfaces, which §12 says
 * is the moment to build a renderer AND wire every surface to it — *"a shared
 * renderer wired to one surface is worse than no shared renderer"*, because the
 * second surface then hand-rolls a copy that drifts.
 *
 * So there is exactly one component, used by the projects table, both card
 * grids, the program banner, both boards, the dashboard and both detail
 * headers. Nothing else formats megawatts.
 *
 * ⚠ THE `title` CARRIES THE DEFINITION ON EVERY VARIANT. `powerTotal` returns
 * `definition` and `hint` precisely so a figure on screen says which quantity
 * it is, and a renderer that drops them re-creates the unlabelled-number bug
 * that `pipeline-value.ts` exists to document. A tooltip is not enough on its
 * own for the big variant, which prints the definition as text.
 *
 * ⚠ ABSENCE IS NOT A BARE EM DASH AT THE FIGURE'S OWN WEIGHT (§12) — that
 * reads as a failed render. In a CARD it is the words "No ramp schedule" at a
 * smaller weight; in an aligned COLUMN it is a muted dash, because the column
 * has a header naming the quantity and the words would repeat down every row.
 * That is the same split `ProjectsTable` already made for money, and two
 * adjacent columns answering absence differently is the worse failure.
 */

/** Everything this component needs. `SubtreePower` is a `PowerTotal` plus the roll-up flags. */
type Total = PowerTotal | SubtreePower

function isRolled(total: Total): total is SubtreePower {
  return 'rolled' in total && total.rolled
}

export function PowerFigure({
  total,
  variant = 'inline',
  className,
}: {
  total: Total
  /**
   * `inline` — beside a record's name on a card or banner.
   * `column`  — right-aligned inside a table cell.
   * `metric`  — the prominent figure on a record's own page.
   */
  variant?: 'inline' | 'column' | 'metric'
  className?: string
}) {
  const rolled = isRolled(total)

  if (total.megawatts == null) {
    if (variant === 'column') {
      return <span className={cn('text-muted-foreground', className)} aria-label="no ramp schedule">—</span>
    }
    if (variant === 'metric') {
      return (
        <div className={cn('flex flex-col gap-0.5', className)}>
          <span className="text-sm text-muted-foreground">No ramp schedule</span>
          <span className="label-caps text-muted-foreground">Total capacity</span>
        </div>
      )
    }
    return null
  }

  const figure = formatMegawatts(total.megawatts)

  if (variant === 'metric') {
    return (
      <div className={cn('flex flex-col gap-0.5', className)} title={total.hint}>
        <span className="text-metric tnum text-foreground">{figure}</span>
        <span className="label-caps text-muted-foreground">
          {rolled ? `${total.definition} · capacity` : 'Total capacity'}
        </span>
      </div>
    )
  }

  if (variant === 'column') {
    return (
      <span className={cn('tnum font-medium text-foreground', className)} title={total.hint}>
        {figure}
        {rolled && <span className="ml-1 text-xs font-normal text-muted-foreground">rolled</span>}
      </span>
    )
  }

  // ⚠ NOT A `Chip`. A chip is the platform's badge for a CATEGORY — a sector, a
  // status, a stage — and the whole point of this figure is that it is the key
  // METRIC, not another label. Giving it a chip's shell would file the most
  // important number on the card among the taxonomy pills beside it. It gets
  // the accent instead, which §12 reserves for meaning and keeps scarce: this
  // is the one number Richard asked to be prominent, and it is the only place
  // the accent appears on a project card.
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold tnum text-primary',
        className
      )}
      title={total.hint}
    >
      <Zap size={12} className="shrink-0" aria-hidden />
      {figure}
      {rolled && <span className="text-xs font-normal text-muted-foreground">rolled</span>}
    </span>
  )
}

/**
 * The second line a detail page shows under the figure: when the next tranche
 * lands, or that the schedule carries no dates.
 *
 * Deliberately separate from `PowerFigure` — a card has no room for it and a
 * table column has none at all, so folding it in would mean three call sites
 * passing `showSchedule={false}`.
 */
export function PowerScheduleNote({
  total,
  className,
}: {
  total: Total
  className?: string
}) {
  if (total.megawatts == null) return null
  const phases = `${total.phases} phase${total.phases === 1 ? '' : 's'}`
  // ⚠ NAME THE ABSENCE IN WORDS RATHER THAN RENDER A DASH. An undated schedule
  // is a real and common state — capacity is known long before the date — and
  // it must not read as a broken date.
  const when =
    total.dated === 0
      ? 'no dates set'
      : total.dated < total.phases
        ? `${total.dated} dated, fully ramped ${formatMonth(total.lastDate)}`
        : `fully ramped ${formatMonth(total.lastDate)}`
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      {phases} · {when}
    </p>
  )
}

/**
 * A DATE column rendered as a month.
 *
 * ⚠ SPLIT, NEVER `new Date(iso)`. A `date` column parsed as a Date lands at UTC
 * midnight, so anyone west of UTC reads the previous day — which on 1 January
 * is the previous YEAR. §12 records this against nine copies of the date
 * formatter, two of which formatted DATE columns and shifted every task due the
 * 1st to the 30th.
 */
function formatMonth(iso: string | null): string {
  if (!iso) return '—'
  const [year, month] = iso.split('-')
  const index = Number(month) - 1
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return names[index] ? `${names[index]} ${year}` : iso
}
