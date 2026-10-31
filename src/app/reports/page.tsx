import Link from 'next/link'
import { BarChart3, FileSpreadsheet, Printer } from 'lucide-react'

import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/card'
import { REPORT_ORDER, REPORTS } from '@/lib/reports/registry'
import { readDealRegister } from '@/lib/reports/deals'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Reports — Ber Wilson Intelligence' }

/**
 * The reports index.
 *
 * ⚠ IT BUILDS NOTHING. The register is read once so each card can say what it
 * covers — "35 deals · 2 priced", "No ramp-up schedules entered yet" — and the
 * builders are never called. A card that lies about a report's contents is
 * worse than a card with no figure, and the figure is cheap; running five
 * builders (one of which reads sixteen Drive rooms) to render five titles is
 * not.
 *
 * ⚠ ADMIN-ONLY BY DEFAULT-DENY. `/reports` is absent from every
 * `ROLE_PAGE_PREFIXES` list in `lib/auth/permissions.ts`, so the middleware
 * turns away every non-admin and the pages need no guard of their own. That is
 * a property of that list being restrictive, not of this file — §12 is blunt
 * that allowlisting a prefix later exposes everything under it.
 */
export default async function ReportsPage() {
  const register = await readDealRegister()

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 sm:px-6">
      <PageHeader
        title="Reports"
        icon={BarChart3}
        description="Canned views of the portfolio, ready to read, send as a spreadsheet, or print on Ber Wilson letterhead."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {REPORT_ORDER.map((key) => {
          const report = REPORTS[key]
          const Icon = report.icon
          return (
            <Panel key={key} className="relative flex flex-col p-4" interactive>
              <Link
                href={`/reports/${key}`}
                // The whole card is the target. `after:absolute inset-0` is the
                // house trick for that without nesting an anchor round a block
                // — and the focus ring lands on the card, not on the words.
                // `flex-1` so a two-line blurb and a three-line one still put
                // their footers on the same baseline across a row — a card grid
                // whose rules sit at four different heights reads as broken
                // alignment rather than as variable content.
                className="flex-1 after:absolute after:inset-0 after:rounded-lg outline-none focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
              >
                <span className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="size-5 text-primary" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-title text-foreground">{report.title}</span>
                    <span className="mt-1 block text-sm leading-snug text-muted-foreground">
                      {report.blurb}
                    </span>
                  </span>
                </span>
              </Link>

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-2.5">
                <span className="label-caps truncate text-muted-foreground">
                  {report.covers(register)}
                </span>
                {/*
                  ⚠ `relative z-10`, OR THE CARD'S OWN `::after` OVERLAY SWALLOWS
                  THESE. A full-card link drawn as a pseudo-element sits above
                  everything that is not in its own stacking context, so two
                  perfectly correct anchors would be unclickable — the §12 shape
                  where every class is right and the thing is inert.
                */}
                <span className="relative z-10 flex shrink-0 items-center gap-1">
                  <a
                    href={`/api/reports/${key}/xlsx`}
                    download
                    title={`Download ${report.title} as a spreadsheet`}
                    className={iconLink}
                  >
                    <FileSpreadsheet className="size-4" />
                    <span className="sr-only">Download {report.title} as Excel</span>
                  </a>
                  <Link
                    href={`/reports/${key}/print`}
                    title={`Print ${report.title}`}
                    className={iconLink}
                  >
                    <Printer className="size-4" />
                    <span className="sr-only">Print {report.title}</span>
                  </Link>
                </span>
              </div>
            </Panel>
          )
        })}
      </div>

      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        Every report can be prepared for an outside reader, which removes win
        probability, capture notes and contact details. Protected projects never
        appear in a report, with or without a step-up — a report is a
        cross-portfolio surface and a PDF of it leaves the building.
        {register.withheld > 0 ? (
          <>
            {' '}
            <span className="text-caution">
              {register.withheld} protected deal{register.withheld === 1 ? ' is' : 's are'} withheld
              from every report below.
            </span>
          </>
        ) : null}
      </p>
    </div>
  )
}

const iconLink = cn(
  'inline-flex size-[2.75rem] items-center justify-center rounded-md text-muted-foreground sm:size-8',
  'transition-colors hover:bg-muted hover:text-foreground',
  'outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
)
