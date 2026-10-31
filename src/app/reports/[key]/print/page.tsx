import Image from 'next/image'
import { notFound } from 'next/navigation'

import { ReportSections } from '@/components/reports/ReportSections'
import { PreparedOn, PrintBar } from '@/components/reports/ReportToolbar'
import { readDealRegister } from '@/lib/reports/deals'
import { reportDef } from '@/lib/reports/registry'
import { applyAudience, isAudience, type ReportAudience } from '@/lib/reports/types'

interface PageProps {
  params: Promise<{ key: string }>
  searchParams: Promise<{ audience?: string }>
}

export async function generateMetadata({ params, searchParams }: PageProps) {
  const [{ key }, { audience }] = await Promise.all([params, searchParams])
  const report = reportDef(key)
  if (!report) return { title: 'Report — Ber Wilson' }
  const day = new Date().toISOString().slice(0, 10)
  /*
   * ⚠ THE TAB TITLE BECOMES THE BROWSER'S SUGGESTED PDF FILENAME, which is the
   * only place this document gets named — there is no PDF library to set
   * metadata with. Dated, and tagged when it is the shareable cut, so a folder
   * of these is readable and an internal copy cannot be mistaken for the one
   * that was sent out.
   */
  const tag = audience === 'external' ? ' (shareable)' : ''
  return { title: `Ber Wilson — ${report.title}${tag} — ${day}` }
}

/**
 * The printed report.
 *
 * ── HOW THE PDF IS MADE ──────────────────────────────────────────────────────
 * The browser makes it. This route renders the document — letterhead, margins,
 * page breaks — and the print dialog's "Save as PDF" turns it into a file. That
 * is the same mechanism as the brief, the objectives board, the weekly report
 * and the org chart, and the reason there is no PDF library in this repo: on a
 * box CLAUDE.md §2 records as having 314MB free with swap full, a headless
 * Chrome is not a dependency, it is an outage.
 *
 * ⚠ THE BODY IS THE SAME COMPONENT THE SCREEN USES. Everything specific to
 * paper is in this wrapper and in `print:` variants — never a second renderer,
 * because a PDF that is a reimplementation of the page is a PDF that will one
 * day print a column the page dropped (§12).
 *
 * ⚠ WHITE, NOT `bg-background`. The theme is light by default and dark on
 * request, and a dark-mode reader hitting print would otherwise get white ink
 * on a background the printer renders as nothing — §12: check which theme the
 * user is in before believing a re-skin landed. Paper has one theme.
 */
export default async function ReportPrintPage({ params, searchParams }: PageProps) {
  const { key } = await params
  const report = reportDef(key)
  if (!report) notFound()

  const { audience: raw } = await searchParams
  const audience: ReportAudience = isAudience(raw) ? raw : 'internal'

  const register = await readDealRegister()
  const data = applyAudience(await report.build(register), audience)

  return (
    <div className="min-h-full bg-white text-foreground">
      <PrintBar reportKey={report.key} audience={audience} />

      {/*
        `@page` has to be inline: it is not a utility and Tailwind cannot emit
        it. Landscape, because these are wide tables and a portrait page turns
        an eleven-column pipeline into something nobody can read — the one
        decision that most determines whether this document is worth printing.
      */}
      <style>{`
        @page { size: letter landscape; margin: 13mm 12mm 15mm; }
        @media print {
          html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          /* A heading stranded at the foot of a page reads as a missing
             section on the page that follows. */
          .report-print h2 { break-after: avoid-page; }
          .report-print thead { display: table-header-group; }
          .report-print tfoot { display: table-row-group; }
        }
      `}</style>

      <div className="report-print mx-auto max-w-6xl px-5 py-8 sm:px-8 print:max-w-none print:px-0 print:py-0">
        {/* ── Letterhead ─────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-6 border-b-2 border-primary pb-5">
          <div className="min-w-0">
            <h1 className="text-display leading-tight text-foreground">{data.title}</h1>
            {data.subtitle ? (
              <p className="mt-1 text-sm text-muted-foreground">{data.subtitle}</p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Ber Wilson · Prepared <PreparedOn />
              {audience === 'external' ? null : ' · Internal'}
            </p>
          </div>
          {/*
            ⚠ `logo-light.png` — the light-background mark, on a page that is
            always white. `logo.png` and `logo-dark.png` are the other two, and
            picking by theme here would print an invisible logo for anyone
            reading the app in dark mode.
          */}
          <Image
            src="/logo-light.png"
            alt="Ber Wilson"
            width={640}
            height={339}
            priority
            className="h-12 w-auto shrink-0 object-contain"
          />
        </header>

        {data.coverage ? (
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{data.coverage}</p>
        ) : null}

        <div className="mt-6">
          <ReportSections data={data} />
        </div>

        <footer className="mt-10 flex items-center justify-between gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            Ber Wilson — Building Futures
            {audience === 'external' ? '' : ' · Internal working document'}
          </span>
          <span className="tnum">
            <PreparedOn />
          </span>
        </footer>
      </div>
    </div>
  )
}
