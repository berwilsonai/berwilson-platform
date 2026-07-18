import Image from 'next/image'
import { createAdminClient } from '@/lib/supabase/admin'
import OrgChart from '@/components/company/OrgChart'
import {
  StructurePrintToolbar,
  PreparedDate,
  ForceLightTheme,
  type PrintDepth,
} from '@/components/company/StructurePrintToolbar'

interface PageProps {
  searchParams: Promise<{ depth?: string }>
}

const DEPTHS: PrintDepth[] = ['high', 'entities', 'full']

function parseDepth(value: string | undefined): PrintDepth {
  return DEPTHS.includes(value as PrintDepth) ? (value as PrintDepth) : 'entities'
}

export async function generateMetadata({ searchParams }: PageProps) {
  const { depth } = await searchParams
  const label = { high: 'Overview', entities: 'Entities', full: 'Full' }[parseDepth(depth)]
  // The tab title becomes the browser's suggested PDF filename.
  return { title: `Ber Wilson — Entity Architecture (${label})` }
}

/**
 * Chromeless print-to-PDF view of the entity architecture (landscape).
 * Depth picker: high (arms + divisions), entities (+ SPVs), full (+ people).
 */
export default async function StructurePrintPage({ searchParams }: PageProps) {
  const depth = parseDepth((await searchParams).depth)

  const supabase = createAdminClient()
  const [{ data: nodes, error }, { data: people }] = await Promise.all([
    supabase.from('org_nodes').select('*').order('sort_order').order('created_at'),
    supabase.from('org_people').select('*').order('sort_order').order('created_at'),
  ])
  if (error) throw new Error(`Failed to load the org structure: ${error.message}`)

  return (
    <div className="min-h-full bg-white text-slate-900">
      <ForceLightTheme />
      {/* Landscape page; shrink the chart slightly so the 4-division row fits. */}
      <style>{`@page { size: letter landscape; margin: 0.4in; } @media print { .org-print-zoom { zoom: 0.8; } }`}</style>
      <StructurePrintToolbar depth={depth} />

      <div className="mx-auto max-w-5xl px-8 py-10 print:max-w-none print:px-0 print:py-0">
        {/* Letterhead */}
        <header className="flex items-start justify-between gap-4 pb-6 border-b-2 border-slate-900">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Entity Architecture</h1>
            <p className="text-sm text-slate-500 mt-1">
              Ber Wilson · Prepared <PreparedDate />
            </p>
          </div>
          <Image
            src="/logo.png"
            alt="Ber Wilson"
            width={120}
            height={65}
            className="object-contain h-9 w-auto"
          />
        </header>

        <div className="mt-8 org-print-zoom overflow-x-auto">
          <OrgChart
            nodes={nodes ?? []}
            people={people ?? []}
            expandedDivisions={depth === 'high' ? new Set<string>() : 'all'}
            showPeople={depth === 'full'}
          />
        </div>

        <footer className="mt-12 pt-4 border-t border-slate-200 text-xs text-slate-400">
          Ber Wilson — internal working document
        </footer>
      </div>
    </div>
  )
}
