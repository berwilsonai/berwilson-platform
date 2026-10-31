'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, FileSpreadsheet, Printer } from 'lucide-react'

import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { AUDIENCE_HINTS, AUDIENCE_LABELS, AUDIENCES, type ReportAudience } from '@/lib/reports/types'

/**
 * The controls above a report: who it is for, then the two ways out of the
 * platform.
 *
 * ⚠ THE AUDIENCE LIVES IN THE URL, NOT IN COMPONENT STATE. §12: *"a filter
 * kept only in component state is not a view — put it in the URL"*. It also
 * has to be in the URL for a structural reason — the Excel route and the print
 * route are separate requests, and they must be handed the same audience the
 * reader was looking at. A `useState` toggle would print one document and
 * download a different one.
 *
 * ⚠ AND THE PRINT PATH IS A ROUTE, NOT `window.print()` ON THIS PAGE. The app
 * chrome (sidebar, header, the Ask dock) is not something `print:hidden` can
 * be trusted to clear on every surface, and the printed document wants its own
 * letterhead and page margins. `/reports/<key>/print` is that document; the
 * browser's own "Save as PDF" is what turns it into a file, which is the same
 * mechanism the brief, the objectives board and the weekly report already use
 * and the reason there is no PDF library in this repo.
 */
export function ReportToolbar({
  reportKey,
  audience,
}: {
  reportKey: string
  audience: ReportAudience
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const withAudience = (next: ReportAudience) => {
    const query = new URLSearchParams(params.toString())
    // `internal` is the default, so it is left out of the URL entirely — a
    // shareable link should not carry a parameter that reads as a setting.
    if (next === 'internal') query.delete('audience')
    else query.set('audience', next)
    const suffix = query.toString()
    return `${pathname}${suffix ? `?${suffix}` : ''}`
  }

  const exportQuery = audience === 'external' ? '?audience=external' : ''

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      {/*
        A segmented control, two options. `role="group"` with real buttons
        rather than a `<select>`: there are two choices and the second one
        changes what leaves the building, so it should be visible rather than
        folded into a menu.
      */}
      <div
        role="group"
        aria-label="Who this report is for"
        className="inline-flex rounded-lg border border-border bg-card p-0.5 elev-1"
      >
        {AUDIENCES.map((option) => {
          const active = option === audience
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              title={AUDIENCE_HINTS[option]}
              onClick={() => router.replace(withAudience(option), { scroll: false })}
              className={cn(
                // ⚠ 44px on touch, 34px from `sm:`. `h-[2.75rem]` is written
                // absolutely rather than as `h-11`, because `h-11` is
                // `calc(var(--spacing) * 11)` and a density change took 66 tap
                // targets below the floor with nothing reporting it (§12).
                'h-[2.75rem] rounded-md px-3 text-sm font-medium transition-colors sm:h-8',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {AUDIENCE_LABELS[option]}
            </button>
          )
        })}
      </div>

      <p className="hidden min-w-0 flex-1 text-xs leading-snug text-muted-foreground sm:block">
        {AUDIENCE_HINTS[audience]}
      </p>

      <div className="ml-auto flex items-center gap-2">
        {/*
          A plain anchor, not `<Link>`: this is a file download, and the App
          Router's client navigation would try to render the xlsx bytes as a
          page. `download` lets the route's own Content-Disposition name it.
        */}
        <a
          href={`/api/reports/${reportKey}/xlsx${exportQuery}`}
          download
          className={buttonVariants({ variant: 'outline', className: 'h-[2.75rem] sm:h-9' })}
        >
          <FileSpreadsheet className="size-4" />
          Excel
        </a>
        <Link
          href={`/reports/${reportKey}/print${exportQuery}`}
          className={buttonVariants({ className: 'h-[2.75rem] sm:h-9' })}
        >
          <Printer className="size-4" />
          <span className="sm:hidden">PDF</span>
          <span className="hidden sm:inline">Print / Save PDF</span>
        </Link>
      </div>
    </div>
  )
}

/**
 * The print page's own bar. Screen-only, and the only thing on that route that
 * is not the document.
 */
export function PrintBar({ reportKey, audience }: { reportKey: string; audience: ReportAudience }) {
  const back = audience === 'external' ? `/reports/${reportKey}?audience=external` : `/reports/${reportKey}`
  return (
    <div className="sticky top-0 z-10 border-b border-border bg-white print:hidden">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-5 py-2.5 sm:px-8">
        <Link
          href={back}
          className="inline-flex h-[2.75rem] items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground sm:h-9"
        >
          <ArrowLeft className="size-3.5" /> Back to the report
        </Link>

        {audience === 'external' ? (
          <span className="rounded bg-positive-surface px-2 py-0.5 text-xs font-medium text-positive ring-1 ring-positive-edge">
            Shareable — internal columns removed
          </span>
        ) : (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border">
            Internal
          </span>
        )}

        <button
          type="button"
          onClick={() => window.print()}
          className={cn(
            'ml-auto inline-flex h-[2.75rem] items-center gap-1.5 whitespace-nowrap rounded-lg bg-foreground px-3.5 text-sm font-medium text-background sm:h-9',
            'transition-colors hover:bg-foreground/90 outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
          )}
        >
          <Printer className="size-4" />
          Print / Save PDF
        </button>
      </div>
    </div>
  )
}

/**
 * The date the document was prepared, rendered on the client.
 *
 * ⚠ CLIENT-SIDE ON PURPOSE. `new Date()` in a server component trips the React
 * Compiler's purity rule (one of the three standing lint exemptions in §9), and
 * more importantly it would render the SERVER's timezone — the Studio is in
 * Utah, which is right today and wrong the moment somebody reads this from
 * elsewhere. The same pattern as `PreparedDate` on the objectives board.
 */
export function PreparedOn() {
  return (
    <>
      {new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })}
    </>
  )
}
