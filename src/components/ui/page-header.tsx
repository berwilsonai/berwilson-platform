import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * PageHeader — the app's one masthead.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Measured 2026-10-27: `<h1>` appeared in 20+ distinct className spellings
 * across the app pages — `text-lg font-semibold`, `text-xl font-semibold
 * leading-tight`, `text-2xl`, `text-base font-semibold`, one in
 * `tracking-widest uppercase`. Nothing was wrong with any of them individually
 * and that is the point: there was no owner, so no two pages opened the same
 * way, and a reader moving between Projects and Contacts crossed a visible
 * seam every time. §12 already names this shape — "a label written inline on
 * four screens is a label with no owner".
 *
 * This is the owner. One size, one weight, one tracking, one spacing rhythm,
 * and the slots a real page actually needs (eyebrow, description, actions,
 * a metric strip, a tab row) so there is no reason to hand-roll the next one.
 *
 * ⚠ THE SIZE WENT 20px → 28px ON 2026-10-27, OVERRIDING THIS FILE'S OWN
 * ARGUMENT OF THE DAY BEFORE. That argument ("a 20px semibold line is what
 * Attio and Linear put above a data surface") was made without having
 * measured the page underneath it. The measurement: 95% of /decide's 611 text
 * nodes render at 13px or 14.5px and exactly ONE is larger. A 20px title over
 * a 14.5px body is a 1.38× step, which is not a masthead, it is the same text
 * slightly bigger — and with no `title` role beneath it there was nothing in
 * between either. 28px is `text-display`, the role token; it is a 1.93× step,
 * and `text-title` at 18px now fills the gap it opens.
 *
 * The rule that did survive: EXACTLY ONE display per page. Anything else that
 * was reaching for 24px is a `title`.
 */
function PageHeader({
  title,
  icon: Icon,
  eyebrow,
  description,
  actions,
  metrics,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  title: React.ReactNode
  /**
   * A lucide icon for the masthead's chip.
   *
   * ⚠ A SLOT, NOT A FREE `ReactNode`, because the chip is the part a page
   * would otherwise re-invent: /decide had `size-9 rounded-lg bg-primary/10`
   * with a `size-5 text-primary` glyph, /attention had a bare `size={16}`
   * inline with the title, and nothing else had one at all. One shape here
   * means they stop disagreeing, and a page cannot put a 40px icon on it.
   */
  icon?: React.ComponentType<{ className?: string }>
  /** Small muted line above the title — a section, a parent record, a count. */
  eyebrow?: React.ReactNode
  /** One sentence under the title. Omitted entirely when absent — never an em dash (§12). */
  description?: React.ReactNode
  /** Buttons, on the title's own baseline. */
  actions?: React.ReactNode
  /** An inline metric strip: `[{ label, value, tone? }]`. */
  metrics?: React.ReactNode
  /** A tab row, rendered flush to the header's bottom rule. */
  children?: React.ReactNode
}) {
  return (
    <div className={cn('mb-5', className)} {...props}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="size-5 text-primary" />
            </span>
          ) : null}
          <div className="min-w-0">
            {eyebrow ? (
              <p className="label-caps mb-1 text-muted-foreground">{eyebrow}</p>
            ) : null}
            <h1 className="truncate text-display text-foreground">{title}</h1>
            {/*
              ⚠ `max-w-2xl` IS LOAD-BEARING, NOT A DEFAULT. Measured
              2026-10-27: /decide and /leads each ran their intro paragraph the
              full 1,451px of the content column — around 190 characters a
              line, roughly three times the width prose stays readable at. The
              writing on these pages is unusually good and was being wasted on
              a measure nobody finishes a line of.
            */}
            {description ? (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {metrics ? <div className="mt-3">{metrics}</div> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  )
}

/**
 * A row of small inline figures for the masthead — the "12 active · $1.2B
 * pipeline · 3 closing" line that saves a whole panel of chrome.
 *
 * Deliberately NOT the big `StatTile`: this is for context a reader glances
 * past, and a 30px number at the top of every list page would compete with the
 * list for the thing the page exists to show.
 */
function HeaderMetrics({
  items,
  className,
  ...props
}: React.ComponentProps<'dl'> & {
  items: Array<{ label: string; value: React.ReactNode; tone?: 'default' | 'positive' | 'caution' | 'critical' }>
}) {
  const TONE = {
    default: 'text-foreground',
    positive: 'text-positive',
    caution: 'text-caution',
    critical: 'text-critical',
  } as const
  return (
    <dl className={cn('flex flex-wrap items-center gap-x-5 gap-y-1.5', className)} {...props}>
      {items.map((m) => (
        <div key={m.label} className="flex items-baseline gap-1.5">
          <dd className={cn('tnum text-sm font-semibold', TONE[m.tone ?? 'default'])}>{m.value}</dd>
          <dt className="text-xs text-muted-foreground">{m.label}</dt>
        </div>
      ))}
    </dl>
  )
}

export { PageHeader, HeaderMetrics }
