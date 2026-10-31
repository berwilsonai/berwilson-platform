import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { PageHeader } from '@/components/ui/page-header'
import { ReportSections } from '@/components/reports/ReportSections'
import { ReportToolbar } from '@/components/reports/ReportToolbar'
import { readDealRegister } from '@/lib/reports/deals'
import { reportDef } from '@/lib/reports/registry'
import { applyAudience, isAudience, type ReportAudience } from '@/lib/reports/types'

interface PageProps {
  params: Promise<{ key: string }>
  searchParams: Promise<{ audience?: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { key } = await params
  const report = reportDef(key)
  return { title: report ? `${report.title} — Ber Wilson` : 'Report — Ber Wilson' }
}

/**
 * One report, on screen.
 *
 * ⚠ `notFound()` ON AN UNKNOWN KEY, NEVER A FALLBACK TO THE FIRST REPORT. §12:
 * a trailing `else` turns a missing arm into a write against another route —
 * `/decide`'s accept chain tested two document kinds, a third fell through and
 * 120 rows answered 404 while typecheck, build and 802 tests stayed green. A
 * report that silently shows a DIFFERENT report is that bug with the numbers
 * still on screen.
 */
export default async function ReportPage({ params, searchParams }: PageProps) {
  const { key } = await params
  const report = reportDef(key)
  if (!report) notFound()

  const { audience: raw } = await searchParams
  // An unrecognised value falls back to the SAFE side: `internal` shows more,
  // so the fallback is the one that never over-shares. (`external` cannot be
  // reached by accident either way — it has to be asked for by name.)
  const audience: ReportAudience = isAudience(raw) ? raw : 'internal'

  const register = await readDealRegister()
  const data = applyAudience(await report.build(register), audience)

  return (
    <div className="mx-auto max-w-6xl px-5 py-6 sm:px-6">
      <PageHeader
        title={data.title}
        icon={report.icon}
        eyebrow={
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground focus-visible:text-foreground"
          >
            <ArrowLeft className="size-3" /> Reports
          </Link>
        }
        description={data.subtitle}
      />

      <ReportToolbar reportKey={report.key} audience={audience} />

      {/*
        ⚠ THE COVERAGE LINE SITS ABOVE THE FIGURES, NOT BELOW THEM. It says how
        many deals are in here and how many were withheld, and §12 is explicit
        that the totals above a filtered list are part of the list — a reader
        who scrolls to a total without having read this will quote it.
      */}
      {data.coverage ? (
        <p className="mb-5 border-l-2 border-primary/40 pl-3 text-sm leading-snug text-muted-foreground">
          {data.coverage}
        </p>
      ) : null}

      <ReportSections data={data} />
    </div>
  )
}
