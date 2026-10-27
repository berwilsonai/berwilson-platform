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
 * ⚠ THE SIZE IS DELIBERATELY SMALL. A 30px serif masthead is a document; a
 * 20px semibold sans line with the actions on the same baseline is what Attio,
 * Linear and Domo put above a data surface, and it buys back the vertical
 * space the density change spent on 2026-10-26.
 */
function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  metrics,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  title: React.ReactNode
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
        <div className="min-w-0">
          {eyebrow ? (
            <p className="label-caps mb-1 text-muted-foreground">{eyebrow}</p>
          ) : null}
          <h1 className="truncate text-xl font-semibold tracking-[-0.02em] text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
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
