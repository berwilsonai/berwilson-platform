import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, Factory } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatValue } from '@/lib/utils/constants'
import {
  STEEL_STAGES,
  isOpenStage,
  formatSqft,
  leadSourceLabel,
  type SteelStage,
} from '@/lib/utils/steel'
import EmptyState from '@/components/shared/EmptyState'
import SteelFilters from '@/components/steel/SteelFilters'
import SteelDealsClient, { type SteelDealCardData } from '@/components/steel/SteelDealsClient'

export const metadata = { title: 'Steel CRM — Ber Wilson Intelligence' }

interface PageProps {
  searchParams: Promise<{ stage?: string; source?: string; sales?: string }>
}

// Accent dots follow the pipeline: amber=quoting, indigo=backlog,
// emerald=collected. Literal classes only.
function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'amber' | 'indigo' | 'emerald' }) {
  const dot =
    tone === 'amber'
      ? 'bg-amber-400'
      : tone === 'indigo'
        ? 'bg-indigo-500'
        : tone === 'emerald'
          ? 'bg-emerald-500'
          : null
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 elev-1">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {dot && <span className={`size-1.5 rounded-full ${dot}`} />}
        {label}
      </p>
      <p className="text-lg font-semibold tnum mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

export default async function SteelPage({ searchParams }: PageProps) {
  const params = await searchParams
  const stage = STEEL_STAGES.includes(params.stage as SteelStage) ? (params.stage as SteelStage) : ''
  const source = params.source ?? ''
  const sales = params.sales ?? ''

  const supabase = createAdminClient()

  // Small dataset — fetch everything once, filter + roll up in memory so the
  // stats band re-scopes with the filters.
  const [{ data: dealRows, error }, { data: members }] = await Promise.all([
    supabase
      .from('steel_deals')
      .select('*')
      .order('updated_at', { ascending: false }),
    supabase
      .from('team_members')
      .select('id, name')
      .eq('active', true)
      .order('created_at', { ascending: true }),
  ])

  if (error) {
    throw new Error(`Failed to load steel deals: ${error.message}`)
  }

  const memberName = new Map((members ?? []).map((m) => [m.id, m.name]))

  // Filter options come from the data — lead sources are a free vocabulary.
  const sources = [...new Set((dealRows ?? []).map((d) => d.lead_source).filter(Boolean))].sort(
    (a, b) => leadSourceLabel(a).localeCompare(leadSourceLabel(b))
  )

  const filtered = (dealRows ?? []).filter((row) => {
    if (stage && row.stage !== stage) return false
    if (source && row.lead_source !== source) return false
    if (sales && row.salesperson_id !== sales) return false
    return true
  })

  const items: SteelDealCardData[] = filtered.map((deal) => ({
    deal,
    salesperson: deal.salesperson_id ? memberName.get(deal.salesperson_id) ?? null : null,
  }))

  const sumValue = (stages: SteelStage[]) =>
    filtered
      .filter((d) => (stages as string[]).includes(d.stage))
      .reduce((acc, d) => acc + (d.value ?? 0), 0)

  const quoting = sumValue(['quote', 'engineering'])
  const backlog = sumValue(['order_placed', 'delivered'])
  const collected = sumValue(['paid'])
  const openSqft = filtered
    .filter((d) => isOpenStage(d.stage))
    .reduce((acc, d) => acc + (d.square_feet ?? 0), 0)

  const count = items.length
  const hasFilters = stage || source || sales

  return (
    <div className="space-y-5">
      {/* Page toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Suspense>
            <SteelFilters stage={stage} source={source} sales={sales} sources={sources} salespeople={members ?? []} />
          </Suspense>
          {count > 0 && (
            <span className="text-xs text-muted-foreground">
              {count} deal{count !== 1 ? 's' : ''}
              {hasFilters ? ' matching' : ''}
            </span>
          )}
        </div>
        <Link
          href="/steel/new"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus size={14} />
          New Deal
        </Link>
      </div>

      {/* Pipeline rollup */}
      {(dealRows?.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Quoting" value={formatValue(quoting)} sub="Quote + engineering" tone="amber" />
          <Stat label="Backlog" value={formatValue(backlog)} sub="Ordered / delivered, unpaid" tone="indigo" />
          <Stat label="Collected" value={formatValue(collected)} sub="Paid to date" tone="emerald" />
          <Stat
            label="Deals"
            value={String(count)}
            sub={openSqft > 0 ? `${formatSqft(openSqft)} open` : hasFilters ? 'Matching filters' : 'In the pipeline'}
          />
        </div>
      )}

      {/* Cards grid or empty state */}
      {count === 0 ? (
        <EmptyState
          icon={Factory}
          title={hasFilters ? 'No deals match these filters' : 'No steel deals yet'}
          description={
            hasFilters
              ? 'Try adjusting the filters above.'
              : 'Track prefab steel deals from quote through engineering, order, delivery, and payment.'
          }
          action={
            !hasFilters ? (
              <Link
                href="/steel/new"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={14} />
                New Deal
              </Link>
            ) : undefined
          }
        />
      ) : (
        <SteelDealsClient items={items} />
      )}
    </div>
  )
}
