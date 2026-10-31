import Link from 'next/link'

import { cn } from '@/lib/utils'
import { Chip } from '@/components/ui/chip'
import { Panel } from '@/components/ui/card'
import { columnAlign, columnTotal, formatCell } from '@/lib/reports/format'
import {
  toCell,
  type BarsSection,
  type NoteSection,
  type ReportColumn,
  type ReportData,
  type ReportRow,
  type ReportSection,
  type StatsSection,
  type TableSection,
} from '@/lib/reports/types'

/**
 * The one renderer for a report's body — used by the on-screen view AND by the
 * print route.
 *
 * ⚠ ONE RENDERER, BOTH SURFACES, AND THAT IS NOT AN OPTIMISATION. §12: *"A
 * shared renderer wired to one surface is worse than no shared renderer"* —
 * the case that earned it was `resolveMeetingTarget` answering the matching
 * question properly for one caller while a trigram threshold drifted beside it
 * for another. A report whose PDF is a second implementation of its screen is
 * a report that will one day print a column the screen dropped.
 *
 * So the difference between screen and paper lives entirely in Tailwind's
 * `print:` variants and in the page wrapper, never in a branch here.
 *
 * ⚠ NOT A `'use client'` MODULE. §12: a helper shared between server pages and
 * client components must live outside a client file, and this one is imported
 * by two server pages. There is nothing interactive in a report body — the
 * controls live in `ReportToolbar`, which is the only client component here.
 */

export function ReportSections({ data }: { data: ReportData }) {
  return (
    <div className="space-y-6 print:space-y-5">
      {data.sections.map((section, i) => (
        <SectionBlock key={`${section.kind}-${i}`} section={section} />
      ))}
    </div>
  )
}

function SectionBlock({ section }: { section: ReportSection }) {
  if (section.kind === 'stats') return <StatsBlock section={section} />
  if (section.kind === 'bars') return <BarsBlock section={section} />
  if (section.kind === 'note') return <NoteBlock section={section} />
  return <TableBlock section={section} />
}

// ─────────────────────────────────────────────────────────────────────────────

function StatsBlock({ section }: { section: StatsSection }) {
  return (
    <section className="break-inside-avoid-page">
      <SectionHeading title={section.title} description={section.description} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
        {section.stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-border bg-card px-4 py-3 elev-1 print:border-border print:px-3 print:py-2 print:shadow-none"
          >
            <p className="label-caps text-muted-foreground">{stat.label}</p>
            {stat.value === null ? (
              /*
               * ⚠ THE ABSENCE IS NAMED IN WORDS, AT A SMALLER WEIGHT. §12: a
               * bare em dash at a value's own weight reads as a failed render.
               * "No schedules entered" at 13px under a label is a fact; "—" at
               * 28px is a bug the reader will report.
               */
              <p className="mt-1 text-sm leading-snug text-muted-foreground">
                {stat.empty ?? 'Not recorded'}
              </p>
            ) : (
              <p
                className={cn(
                  'mt-0.5 text-metric tnum',
                  stat.tone === 'critical' && 'text-critical',
                  stat.tone === 'caution' && 'text-caution',
                  stat.tone === 'positive' && 'text-positive'
                )}
              >
                {stat.value}
              </p>
            )}
            {stat.hint ? (
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{stat.hint}</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function BarsBlock({ section }: { section: BarsSection }) {
  const max = section.max ?? Math.max(1, ...section.bars.map((bar) => bar.value))
  return (
    <section className="break-inside-avoid-page">
      <SectionHeading title={section.title} description={section.description} />
      <Panel className="px-4 py-3.5 print:shadow-none">
        <div className="space-y-2.5">
          {section.bars.map((bar) => (
            <div key={bar.label} className="grid grid-cols-[minmax(6.5rem,9rem)_1fr_auto] items-center gap-3">
              <span className="truncate text-sm text-foreground">{bar.label}</span>
              {/*
                The track and the fill. A bar is a div with a width — no chart
                library, which also means it prints: a canvas renders blank on
                paper, and the PDF is half this feature.
              */}
              <span className="h-2.5 w-full overflow-hidden rounded-full bg-muted print:border print:border-border">
                <span
                  className={cn(
                    'block h-full rounded-full',
                    bar.tone ? barFill(bar.tone) : 'bg-primary'
                  )}
                  style={{ width: `${Math.max(2, (bar.value / max) * 100)}%` }}
                />
              </span>
              <span className="tnum whitespace-nowrap text-sm font-medium text-foreground">
                {bar.display}
                {bar.note ? (
                  <span className="ml-2 font-normal text-muted-foreground">{bar.note}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
        {section.coverage ? <Coverage text={section.coverage} className="mt-3" /> : null}
      </Panel>
    </section>
  )
}

/**
 * A bar's fill.
 *
 * ⚠ LITERAL CLASS STRINGS, NEVER INTERPOLATED. §12: a Tailwind class assembled
 * at runtime is a class Tailwind never generated, so `bg-${tone}-500` renders
 * nothing at all and the bar is invisible — with every class correct in the
 * source. Keyed on the tone NAME, declared here.
 */
function barFill(tone: string): string {
  const fills: Record<string, string> = {
    positive: 'bg-positive',
    caution: 'bg-caution',
    critical: 'bg-critical',
    severe: 'bg-critical',
    info: 'bg-chart-2',
    neutral: 'bg-muted-foreground/50',
    violet: 'bg-chart-4',
    indigo: 'bg-chart-4',
    cyan: 'bg-chart-2',
    sky: 'bg-chart-2',
    teal: 'bg-chart-5',
    rose: 'bg-chart-4',
    orange: 'bg-chart-3',
  }
  return fills[tone] ?? 'bg-primary'
}

// ─────────────────────────────────────────────────────────────────────────────

function NoteBlock({ section }: { section: NoteSection }) {
  return (
    <section className="break-inside-avoid-page">
      <div
        className={cn(
          'rounded-lg border px-4 py-3',
          section.tone === 'caution'
            ? 'border-caution-edge bg-caution-surface'
            : 'border-border bg-muted/40'
        )}
      >
        <p className="text-sm font-medium text-foreground">{section.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{section.body}</p>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function TableBlock({ section }: { section: TableSection }) {
  const body = section.groups ? section.groups.flatMap((group) => group.rows) : section.rows ?? []
  const columns = section.columns

  return (
    <section className="break-inside-avoid-page print:break-inside-auto">
      <SectionHeading title={section.title} description={section.description} count={body.length} />
      <Panel className="overflow-hidden print:shadow-none">
        {body.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {section.empty ?? 'Nothing to show.'}
          </p>
        ) : (
          /*
           * ⚠ THE SCROLLER IS SCOPED TO THE TABLE AND UNDONE FOR PRINT.
           * `overflow-x-auto` makes a scroll container, which clips anything
           * absolute inside it and makes a sticky child stick to nothing (§12)
           * — there is neither here, and the `print:overflow-visible` is what
           * stops a wide table being cropped at the paper's edge instead of
           * shrinking to it.
           */
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-full border-collapse text-sm print:text-[8.5pt]">
              <thead>
                <tr className="border-b border-border bg-muted/40 print:bg-transparent">
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={cn(
                        'label-caps px-3 py-2 text-muted-foreground print:px-1.5 print:py-1',
                        column.format === 'text' ? null : 'whitespace-nowrap',
                        columnAlign(column) === 'right' ? 'text-right' : 'text-left'
                      )}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.groups
                  ? section.groups.map((group) => (
                      <GroupRows key={group.label} group={group} columns={columns} />
                    ))
                  : (section.rows ?? []).map((row) => (
                      <BodyRow key={row.id} row={row} columns={columns} />
                    ))}
              </tbody>
              {section.totals ? (
                <tfoot>
                  <tr className="border-t-2 border-primary/40">
                    {columns.map((column, i) => {
                      if (i === 0) {
                        return (
                          <th
                            key={column.key}
                            scope="row"
                            className="px-3 py-2 text-left text-sm font-semibold print:px-1.5"
                          >
                            Total
                            <span className="ml-2 font-normal text-muted-foreground tnum">
                              {body.length} row{body.length === 1 ? '' : 's'}
                            </span>
                          </th>
                        )
                      }
                      const total = column.total ? columnTotal(body, column) : null
                      return (
                        <td
                          key={column.key}
                          className={cn(
                            'px-3 py-2 text-sm font-semibold tnum print:px-1.5',
                            columnAlign(column) === 'right' ? 'text-right' : 'text-left'
                          )}
                        >
                          {total === null
                            ? ''
                            : formatCell({ value: total }, column.format, { exact: false })}
                        </td>
                      )
                    })}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
        {section.coverage ? (
          <Coverage text={section.coverage} className="border-t border-border px-4 py-2.5" />
        ) : null}
      </Panel>
    </section>
  )
}

function GroupRows({
  group,
  columns,
}: {
  group: NonNullable<TableSection['groups']>[number]
  columns: ReportColumn[]
}) {
  return (
    <>
      <tr className="border-b border-border bg-muted/30 print:bg-transparent">
        <th
          scope="colgroup"
          colSpan={columns.length}
          className="px-3 py-1.5 text-left print:px-1.5"
        >
          <span className="inline-flex items-center gap-2">
            {group.tone ? (
              // ⚠ THE `Chip` PRIMITIVE, NOT A HAND-ROLLED SPAN. §12 measured
              // 274 buttons bypassing `<Button>` and 2,214 colour classes
              // bypassing the palette, so two sessions' restyling reached
              // almost nothing — a primitive only styles what uses it.
              <Chip tone={group.tone} className="text-sm">
                {group.label}
              </Chip>
            ) : (
              <span className="text-sm font-semibold text-foreground">{group.label}</span>
            )}
            {group.summary ? (
              <span className="text-xs font-normal text-muted-foreground tnum">{group.summary}</span>
            ) : null}
          </span>
        </th>
      </tr>
      {group.rows.map((row) => (
        <BodyRow key={row.id} row={row} columns={columns} />
      ))}
    </>
  )
}

function BodyRow({ row, columns }: { row: ReportRow; columns: ReportColumn[] }) {
  return (
    <tr
      className={cn(
        'border-b border-border/60 last:border-0 print:break-inside-avoid',
        row.emphasis && 'font-medium'
      )}
    >
      {columns.map((column, i) => {
        const cell = toCell(row.cells[column.key])
        const text = formatCell(cell, column.format)
        const align = columnAlign(column)
        return (
          <td
            key={column.key}
            className={cn(
              'px-3 py-1.5 align-top print:px-1.5 print:py-1',
              align === 'right' ? 'text-right tnum' : 'text-left',
              column.format === 'number' || column.format === 'percent' ? 'tnum' : null,
              /*
               * ⚠ TEXT WRAPS, FIGURES DO NOT — AND THE FIRST VERSION HAD THIS
               * BACKWARDS, WHICH PUSHED THE CAPACITY AND VALUE COLUMNS OFF THE
               * SCREEN ENTIRELY. It let only column 0 wrap and set
               * `whitespace-nowrap` on everything else, so a location reading
               * "Myton, UT; Price/Helper, UT; Roosevelt, UT" and a counterparty
               * reading "Daves Farms Property Holdings, LLC" each claimed a
               * full line of width and the six columns after them left the
               * viewport. The two columns Richard asked for by name were the
               * ones you could not see. Found by screenshotting the page;
               * `tsc`, the build and 1,015 tests were green.
               *
               * A figure still must not wrap: "$12.1B" broken over two lines
               * is unreadable, and a date split after the comma reads as two
               * dates.
               */
              column.format === 'text' ? 'min-w-0' : 'whitespace-nowrap'
            )}
          >
            {/*
              ⚠ THE TEST IS "IS THERE SOMETHING TO SAY", NOT "IS THERE A
              VALUE". It was `cell.value !== null`, which was meant to stop an
              em dash being chipped and instead dropped the chip from every
              cell whose whole point is its LABEL — `{ value: null, label: 'No
              correspondence', tone: 'critical' }` on the eight deals nobody
              has ever written about rendered as plain body text, the one row
              class the report exists to surface.
            */}
            {cell.tone && text !== '—' ? (
              <Chip tone={cell.tone}>{text}</Chip>
            ) : cell.href ? (
              /*
               * A link on screen and plain ink on paper. `print:no-underline`
               * plus the inherited colour means the PDF does not have a column
               * of blue — a printed link is just text that was once clickable.
               */
              <Link
                href={cell.href}
                className="text-foreground underline-offset-2 hover:underline focus-visible:underline print:no-underline"
              >
                {text}
              </Link>
            ) : (
              <span className={cn(text === '—' && 'text-muted-foreground/60')}>{text}</span>
            )}
            {i === 0 && row.detail ? (
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                {row.detail}
              </span>
            ) : null}
          </td>
        )
      })}
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function SectionHeading({
  title,
  description,
  count,
}: {
  title: string
  description?: string
  count?: number
}) {
  return (
    <div className="mb-2.5">
      <h2 className="text-title text-foreground">
        {title}
        {count !== undefined ? (
          <span className="ml-2 text-sm font-normal text-muted-foreground tnum">{count}</span>
        ) : null}
      </h2>
      {description ? (
        <p className="mt-0.5 max-w-3xl text-sm leading-snug text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}

/**
 * The coverage line — what the figures above do and do not cover.
 *
 * ⚠ IT IS PART OF THE TABLE, NOT A FOOTNOTE. §12: *"the TOTALS above a filtered
 * list are part of the list"*, and a total over 2 of 35 rows with nothing
 * saying so is a number the reader will quote.
 */
function Coverage({ text, className }: { text: string; className?: string }) {
  return <p className={cn('text-xs leading-snug text-muted-foreground', className)}>{text}</p>
}
