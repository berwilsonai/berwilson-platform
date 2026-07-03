import Image from 'next/image'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  OBJECTIVE_BUCKETS,
  OBJECTIVE_BUCKET_LABELS,
  objectiveBucket,
  type ObjectiveBucket,
} from '@/lib/utils/objectives'
import { PrintToolbar, PreparedDate } from '@/components/objectives/PrintToolbar'

interface PageProps {
  searchParams: Promise<{ bucket?: string }>
}

export async function generateMetadata({ searchParams }: PageProps) {
  const params = await searchParams
  const bucket = params.bucket && OBJECTIVE_BUCKETS.includes(params.bucket as ObjectiveBucket)
    ? (params.bucket as ObjectiveBucket)
    : null
  // The tab title becomes the browser's suggested PDF filename.
  return {
    title: bucket
      ? `Ber Wilson — Objectives (${OBJECTIVE_BUCKET_LABELS[bucket]})`
      : 'Ber Wilson — Objectives',
  }
}

interface PrintObjective {
  id: string
  title: string
  note: string | null
  bucket: string
  target_date: string | null
  owner: { name: string } | null
}

function formatTargetDate(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default async function ObjectivesPrintPage({ searchParams }: PageProps) {
  const params = await searchParams
  const selected = params.bucket && OBJECTIVE_BUCKETS.includes(params.bucket as ObjectiveBucket)
    ? (params.bucket as ObjectiveBucket)
    : null

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('objectives')
    .select('id, title, note, bucket, target_date, owner:team_members(name)')
    .eq('status', 'active')
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(`Failed to load objectives: ${error.message}`)
  }

  const objectives = (data ?? []) as unknown as PrintObjective[]
  const buckets = selected ? [selected] : OBJECTIVE_BUCKETS
  const sections = buckets.map((b) => ({
    bucket: b,
    items: objectives.filter((o) => objectiveBucket(o.bucket) === b),
  }))

  return (
    <div className="min-h-full bg-white text-slate-900">
      <PrintToolbar bucket={selected ?? 'all'} />

      <div className="mx-auto max-w-3xl px-8 py-10 print:max-w-none print:px-0 print:py-0">
        {/* Letterhead */}
        <header className="flex items-start justify-between gap-4 pb-6 border-b-2 border-slate-900">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Strategic Objectives
              {selected && <span className="text-slate-500"> — {OBJECTIVE_BUCKET_LABELS[selected]}</span>}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Ber Wilson · Prepared <PreparedDate />
            </p>
          </div>
          <Image src="/logo.png" alt="Ber Wilson" width={120} height={65} className="object-contain h-9 w-auto" />
        </header>

        {/* Sections */}
        {sections.map(({ bucket, items }) => (
          <section key={bucket} className="mt-8 break-inside-avoid-page">
            <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 pb-2 border-b border-slate-200">
              {OBJECTIVE_BUCKET_LABELS[bucket]}
              <span className="ml-2 font-normal normal-case tracking-normal">
                {items.length} objective{items.length === 1 ? '' : 's'}
              </span>
            </h2>

            {items.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">None.</p>
            ) : (
              <ol className="mt-1 divide-y divide-slate-100">
                {items.map((obj, idx) => (
                  <li key={obj.id} className="flex items-start gap-4 py-4 break-inside-avoid">
                    <span className="shrink-0 mt-0.5 inline-flex items-center justify-center size-7 rounded-full bg-slate-900 text-white text-sm font-semibold tabular-nums">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-medium leading-snug">{obj.title}</p>
                      {obj.note && (
                        <p className="text-sm text-slate-600 mt-1 whitespace-pre-line">{obj.note}</p>
                      )}
                      {(obj.owner || obj.target_date) && (
                        <p className="text-xs text-slate-500 mt-1.5">
                          {obj.owner && <>Owner: {obj.owner.name}</>}
                          {obj.owner && obj.target_date && ' · '}
                          {obj.target_date && <>Target: {formatTargetDate(obj.target_date)}</>}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}

        <footer className="mt-12 pt-4 border-t border-slate-200 text-xs text-slate-400">
          Ber Wilson — internal working document
        </footer>
      </div>
    </div>
  )
}
