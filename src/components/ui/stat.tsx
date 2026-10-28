import * as React from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/card'

/**
 * StatTile — the KPI unit of the dashboard.
 *
 * ── WHY IT IS A COMPONENT AND NOT MARKUP IN HealthPanel ─────────────────────
 * The KPI band was 180 lines of hand-written `<div className="min-w-0 flex
 * items-start gap-3">` repeated four times, each with its own icon chip colour
 * picked by hand — `bg-violet-100`, `bg-emerald-100`, `bg-amber-100`. That is
 * decorative colour on a surface whose entire job is to make the ONE number
 * that is wrong stand out, and §12 is explicit: when every tile is coloured,
 * colour has stopped signifying. Four coloured chips in a row is the "when
 * every row is red" failure wearing pastels.
 *
 * So the tile has NO decorative colour. The label is muted, the figure is ink,
 * and `tone` is reserved for a figure that actually means something is wrong —
 * at which point it is the only colour in the band and cannot be missed.
 *
 * ⚠ A TILE WITH NO VALUE IS NOT A TILE. Pass `value={null}` and it renders the
 * `empty` line in muted text at body size rather than a 30px "Not set", which
 * is an instruction masquerading as a measurement (§12: a bare em dash at a
 * value's own weight reads as a failed render).
 */
function StatTile({
  label,
  value,
  empty = 'Not set',
  hint,
  tone = 'default',
  delta,
  deltaGood = 'up',
  href,
  trend,
  footer,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  label: React.ReactNode
  /** The figure. `null` renders `empty` at body weight instead. */
  value: React.ReactNode | null
  empty?: React.ReactNode
  /** One muted line under the figure — what it covers, what it excludes. */
  hint?: React.ReactNode
  /** Colour the FIGURE. Only when the number itself is the warning. */
  tone?: 'default' | 'positive' | 'caution' | 'critical'
  /**
   * Movement since an earlier snapshot — `{ change: 0.042, sinceDays: 7 }`
   * renders "↑ 4.2% vs last week".
   *
   * ⚠ OMITTED ENTIRELY WHEN THERE IS NO HISTORY, never rendered as "—" or
   * "0%". §12: a placeholder at a value's own weight reads as a failed render,
   * and for the first weeks after `portfolio_snapshots` starts filling there
   * is genuinely nothing to say. `deltaFrom` returns null for that case; pass
   * it straight through.
   */
  delta?: { change: number; sinceDays: number } | null
  /**
   * Which direction is GOOD. Default `up`. Overdue tasks and open commitments
   * are the inverse: a rise is bad, and colouring it green because the number
   * went up would be the tile lying about its own subject.
   */
  deltaGood?: 'up' | 'down'
  href?: string
  /** A sparkline's series. Drawn at the tile's foot; see `Sparkline`. */
  trend?: number[]
  /** Extra lines under the hint — a link, a caveat, a breakdown. */
  footer?: React.ReactNode
}) {
  const TONE = {
    default: 'text-foreground',
    positive: 'text-positive',
    caution: 'text-caution',
    critical: 'text-critical',
  } as const

  /*
    ⚠ A ZERO IS A REAL MEASUREMENT AND STILL SHOULD NOT SHOUT (§4.7). Three of
    the four tiles on /investors read "$0" at the full 30px ink weight, which
    gives a figure that means "nothing has happened yet" the same emphasis as
    one that means "$12B" — and when every tile is loud, none of them is. A
    genuine zero stays at the metric's size, so the band keeps its rhythm, and
    drops to muted so the first real number pops the day it arrives.
    This is NOT the `value === null` case below: that is a tile with nothing
    to show at all, and it says so in words.
  */
  const isZero =
    tone === 'default' &&
    (value === 0 || (typeof value === 'string' && /^[^\d]*0([^\d]|$)/.test(value.trim())))

  const body = (
    <>
      <dt className="label-caps text-muted-foreground">{label}</dt>
      {value === null ? (
        <dd className="mt-1.5 text-sm text-muted-foreground">{empty}</dd>
      ) : (
        <dd className={cn('tnum mt-1 text-metric', isZero ? 'text-muted-foreground' : TONE[tone])}>
          {value}
        </dd>
      )}
      {delta ? <dd className="mt-1"><DeltaLine delta={delta} good={deltaGood} /></dd> : null}
      {hint ? <dd className="mt-1 text-xs text-muted-foreground">{hint}</dd> : null}
      {footer ? <dd className="mt-1 text-xs">{footer}</dd> : null}
      {trend && trend.length > 1 ? (
        <dd className="mt-3">
          <Sparkline values={trend} tone={tone} />
        </dd>
      ) : null}
    </>
  )

  /*
    ⚠ `<Panel>`, NOT A HAND-ROLLED SHELL. The first draft of this wrote
    `rounded-lg border border-border bg-card elev-1` inline — and
    `conventions.test.ts` failed the build for it, correctly: that ratchet
    exists because 232 such shells accumulated before anyone noticed there were
    two card radii on one screen. A new shared primitive is exactly the place
    the next one would have started.

    A `<div>` is a legal child of `<dl>`, so Panel's element works unchanged
    inside `StatGrid` while `dt`/`dd` keep the semantics.
  */
  /*
    ⚠ `h-full` IS LOAD-BEARING ON BOTH ELEMENTS, NOT DECORATION. A grid item
    stretches by default, so a bare `<Panel>` fills the band's row height and
    every tile ends level. Wrapping one in a `<Link>` moves that stretch to the
    LINK — the Panel inside becomes an ordinary block at content height — so the
    single tile with an `href` rendered short while its siblings ran on, and
    /dashboard's KPI band had a ragged bottom edge for as long as it has existed.
    Nothing reports this: every class is correct, the build is green, and the
    only evidence is a screenshot.
  */
  const tile = (
    <Panel interactive={!!href} className={cn('h-full min-w-0 px-4 py-3.5', href && 'hover:border-primary/40', className)} {...props}>
      {body}
    </Panel>
  )

  return href ? (
    <Link href={href} className="block h-full min-w-0">
      {tile}
    </Link>
  ) : (
    tile
  )
}

/**
 * The movement line under a figure.
 *
 * ⚠ FLAT IS A RESULT AND SAYS SO IN WORDS. A change that rounds to 0.0% gets
 * "no change", not "↑ 0.0%" — an arrow pointing up beside a zero is the kind
 * of unlabelled figure §12 keeps catching, and "no change" is information a
 * reader can act on.
 *
 * ⚠ THE COLOUR FOLLOWS THE SUBJECT, NOT THE SIGN. `good` exists because
 * `overdue_tasks` rising is bad; without it the tile would paint a growing
 * backlog green.
 */
function DeltaLine({
  delta,
  good,
}: {
  delta: { change: number; sinceDays: number }
  good: 'up' | 'down'
}) {
  const pct = delta.change * 100
  const flat = Math.abs(pct) < 0.05
  const up = pct > 0
  const helpful = up === (good === 'up')
  const tone = flat ? 'text-muted-foreground' : helpful ? 'text-positive' : 'text-critical'

  return (
    <span className={cn('inline-flex items-baseline gap-1 text-xs', tone)}>
      {flat ? null : <span aria-hidden="true">{up ? '↑' : '↓'}</span>}
      <span className="tnum">{flat ? 'No change' : `${Math.abs(pct).toFixed(1)}%`}</span>
      <span className="text-muted-foreground">{sincePhrase(delta.sinceDays)}</span>
    </span>
  )
}

/**
 * "vs last week" / "vs 11 days ago".
 *
 * ⚠ THE SNAPSHOT IS WEEKLY BUT ITS AGE IS NOT GUARANTEED — a missed cron, a
 * box that slept, a week where the job was added mid-week. Saying "vs last
 * week" over a 19-day-old figure would be a quiet lie, so the phrase is
 * derived from the real gap and only claims a week when it is one.
 */
function sincePhrase(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'vs yesterday'
  if (days >= 6 && days <= 8) return 'vs last week'
  if (days >= 28 && days <= 31) return 'vs last month'
  return `vs ${days} days ago`
}

/**
 * Sparkline — inline SVG, no charting dependency.
 *
 * ⚠ DELIBERATELY NOT A CHART LIBRARY. §11 forbids adding complexity without
 * demonstrated need, and the demonstrated need here is one 56×20 polyline.
 * Recharts would be ~90KB of JavaScript and a client boundary on a server
 * component, to draw a shape that is nine lines of path arithmetic.
 *
 * `preserveAspectRatio="none"` lets it stretch to whatever width the tile has
 * without the caller computing one, and `vector-effect` keeps the stroke a
 * true 1.5px after that stretch — without it a wide tile draws a hairline and
 * a narrow one draws a slab.
 */
function Sparkline({
  values,
  tone = 'default',
  className,
}: {
  values: number[]
  tone?: 'default' | 'positive' | 'caution' | 'critical'
  className?: string
}) {
  const W = 100
  const H = 24
  const min = Math.min(...values)
  const max = Math.max(...values)
  // A flat series has no range to divide by; draw it down the middle rather
  // than dividing by zero and emitting `NaN` into the markup (§12).
  const span = max - min || 1
  const step = values.length > 1 ? W / (values.length - 1) : W
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${(H - ((v - min) / span) * H).toFixed(2)}`)

  const STROKE = {
    default: 'stroke-muted-foreground',
    positive: 'stroke-positive',
    caution: 'stroke-caution',
    critical: 'stroke-critical',
  } as const

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn('h-6 w-full', className)}
      aria-hidden
      focusable="false"
    >
      <polyline
        points={pts.join(' ')}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className={STROKE[tone]}
      />
    </svg>
  )
}

/**
 * StatGrid — the band the tiles sit in. One place that decides how many fit,
 * so a page cannot invent a fifth column that wraps badly on a laptop.
 */
function StatGrid({ className, ...props }: React.ComponentProps<'dl'>) {
  return (
    <dl
      className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}
      {...props}
    />
  )
}

export { StatTile, StatGrid, Sparkline }
